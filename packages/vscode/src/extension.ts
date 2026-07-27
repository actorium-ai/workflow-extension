import * as vscode from 'vscode';

import { AuthManager } from './auth/oauth.js';
import { getActoriumConfig } from './config/environment.js';
import { ACTORIUM_DOC_SCHEME, DocContentProvider } from './navigator/doc-content-provider.js';
import { NavigatorPanelProvider } from './navigator/panel.js';
import { codingApiConfig, getWorkspaceRepos } from './navigator/workflow-api.js';
import { VersionChecker } from './version/checker.js';
import { writeAgentsFile } from './workspace/agentsFile.js';
import {
  consumePendingWorkspaceSync,
  ensureWorkspaceFolder,
  getWorkspaceFolder,
  stashPendingWorkspaceSync,
} from './workspace/folderManager.js';
import {
  type AgentTarget,
  connectClaudeCode,
  connectCodex,
  connectOpencode,
  disconnectClaudeCode,
  disconnectCodex,
  disconnectOpencode,
  envWithPnpmBin,
  genericMcpConfigSnippet,
  type McpConnectResult,
} from './workspace/mcpConnect.js';
import { addRepo } from './workspace/repoLinker.js';
import { writeWorkspaceManifest } from './workspace/workspaceManifest.js';

let authManager: AuthManager;
let navigatorProvider: NavigatorPanelProvider;
let versionChecker: VersionChecker;
let extContext: vscode.ExtensionContext;

interface OrgWorkspaceNames {
  orgName: string;
  workspaceName: string;
}

/** Splits AuthManager's "<workspace> · <org>" display label back into its
 * parts — the label is the only place either name is currently plumbed to
 * (see AuthManager._pickWorkspaceForOrg), so this is the one place both
 * commands and AGENTS.md generation recover them from. */
function parseWorkspaceLabel(label: string | null): OrgWorkspaceNames | null {
  if (!label) return null;
  const [workspaceName, orgName] = label.split(' · ');
  if (!workspaceName || !orgName) return null;
  return { orgName, workspaceName };
}

/** Regenerates AGENTS.md and the .actorium/workspace.json manifest at the
 * workspace folder's root from the current org/workspace state — called
 * after every repo add/clone/unlink so the files an agent (or actorium-mcp
 * itself, for the manifest — see workspaceManifest.ts) reads always reflect
 * what's actually linked/selected. AGENTS.md itself no longer needs the
 * linked-repo list threaded in — it just points at .actorium/repo-links.json
 * (see agentsFile.ts), which repoLinker.ts/repoLinkManifest.ts keep current
 * on every repo-state change directly. */
async function regenerateAgentsFile(folderPath: string): Promise<void> {
  const names = parseWorkspaceLabel(authManager.getWorkspaceLabel());
  const workspaceId = authManager.getWorkspaceId();
  const orgId = authManager.getOrgId();
  if (!names || !workspaceId) return;
  await writeAgentsFile(folderPath, { ...names, workspaceId });
  if (orgId) await writeWorkspaceManifest(folderPath, { workspaceId, orgId });
}

/** Resolves (prompting if needed) the workspace folder for the currently
 * selected workspace — the shared precondition every workspace-folder
 * command needs. Shows a warning and returns undefined if not
 * connected/selected. Keyed by workspace (not org): see
 * folderManager.ts's getWorkspaceFolder for why. */
async function resolveCurrentWorkspaceFolder(): Promise<string | undefined> {
  const workspaceId = authManager.getWorkspaceId();
  const names = parseWorkspaceLabel(authManager.getWorkspaceLabel());
  if (!workspaceId || !names) {
    vscode.window.showWarningMessage('Actorium: Connect and select a workspace first.');
    return undefined;
  }
  return ensureWorkspaceFolder(
    extContext,
    workspaceId,
    `${names.workspaceName} (${names.orgName})`,
  );
}

/**
 * Nudges the user to link a local workspace folder the first time they
 * select a workspace that has none yet — a one-time information message
 * rather than an immediately-blocking QuickPick, since not every user opens
 * a local coding agent in the first session. Silently does nothing on every
 * later switch back to a workspace that already has a folder linked.
 */
async function promptLinkWorkspaceFolderIfNeeded(): Promise<void> {
  const workspaceId = authManager.getWorkspaceId();
  if (!workspaceId || getWorkspaceFolder(extContext, workspaceId)) return;
  const names = parseWorkspaceLabel(authManager.getWorkspaceLabel());
  if (!names) return;

  const choice = await vscode.window.showInformationMessage(
    `Actorium: Link a local workspace folder for "${names.workspaceName}" (${names.orgName}) to use local coding agents (Claude Code, etc.) with Actorium context.`,
    'Link folder',
    'Not now',
  );
  if (choice === 'Link folder') {
    await vscode.commands.executeCommand('actorium.openWorkspaceFolder');
  }
}

/** Regenerates AGENTS.md and opens `folderPath` in this window (reusing it
 * rather than spawning a new one) — the workspace folder is the root a
 * local coding agent should be pointed at, so swapping the current window's
 * folder to it is more useful than piling up a separate window per
 * workspace. Shared by the explicit "Open Workspace Folder" command and the
 * automatic re-sync below on every workspace switch. */
async function openWorkspaceFolderInThisWindow(folderPath: string): Promise<void> {
  await regenerateAgentsFile(folderPath);
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), {
    forceReuseWindow: true,
  });
}

/**
 * Keeps the VS Code window's own opened folder in sync with whichever
 * workspace is currently selected — switching workspace in the pill/picker
 * previously only updated the Navigator sidebar, leaving the editor pointed
 * at whatever folder (or nothing) was already open. If the new workspace
 * already has a folder linked and it isn't already open, reopens this
 * window into it. If nothing's linked yet, falls back to the existing
 * "prompt to link" nudge instead of silently creating a folder without
 * asking where.
 */
async function syncWindowToWorkspace(workspaceId: string): Promise<void> {
  const folderPath = getWorkspaceFolder(extContext, workspaceId);
  if (!folderPath) {
    await promptLinkWorkspaceFolderIfNeeded();
    return;
  }

  const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (currentFolder === folderPath) return;

  // About to reload into a different folder — stash the selection we just
  // made so the reactivated extension can recover it. Without this, the
  // reload restores whatever selection was last associated with *that*
  // folder specifically (workspaceState is per-folder), which can be a
  // stale, unrelated workspace rather than the one just picked.
  const workspaceLabel = authManager.getWorkspaceLabel();
  if (workspaceLabel) {
    await stashPendingWorkspaceSync(extContext, {
      folderPath,
      workspaceId,
      workspaceLabel,
      orgId: authManager.getOrgId(),
    });
  }

  await openWorkspaceFolderInThisWindow(folderPath);
}

/** Dispatches to the right connect function for one agent target — shared
 * by the Command Palette's multi-target picker and the Navigator webview's
 * per-agent "Connect" button (which already knows which target it wants,
 * skipping the picker). */
function connectAgentByTarget(
  target: AgentTarget,
  folderPath: string,
  bffUrl: string,
): Promise<McpConnectResult> {
  switch (target) {
    case 'claude':
      return connectClaudeCode(folderPath, bffUrl);
    case 'codex':
      return connectCodex(folderPath, bffUrl);
    case 'opencode':
      return connectOpencode(folderPath, bffUrl);
  }
}

function disconnectAgentByTarget(
  target: AgentTarget,
  folderPath: string,
): Promise<McpConnectResult> {
  switch (target) {
    case 'claude':
      return disconnectClaudeCode(folderPath);
    case 'codex':
      return disconnectCodex(folderPath);
    case 'opencode':
      return disconnectOpencode(folderPath);
  }
}

const AGENT_CLI_LABEL: Record<AgentTarget, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
};

/** Opens a terminal in the workspace folder and starts the given agent's
 * CLI — `target` doubles as its own CLI command name (`claude`/`codex`/
 * `opencode`). Uses the same PATH repair as the connect/disconnect health
 * checks (envWithPnpmBin) since these binaries may only be on PATH via
 * pnpm's global bin dir, which a terminal spawned by VS Code won't have
 * sourced otherwise. Always opens a fresh terminal rather than reusing an
 * active one, since sending a CLI-launch command into whatever terminal the
 * user happens to have focused (mid-command, mid-prompt) would be unsafe. */
function openAgentCli(target: AgentTarget, folderPath: string): void {
  const terminal = vscode.window.createTerminal({
    name: `Actorium: ${AGENT_CLI_LABEL[target]}`,
    cwd: folderPath,
    env: envWithPnpmBin(),
  });
  terminal.show();
  terminal.sendText(target);
}

/**
 * Registers the actorium-mcp server with the local coding agent of the
 * user's choice. Runs against the workspace folder (prompting to link one
 * if needed) since that's the directory these agents are meant to be opened
 * in — `cwd`-scoped registrations (Claude Code's `--scope local`, opencode's
 * project-root opencode.json) land there rather than wherever the extension
 * host process happens to be running from.
 */
async function addMcpServer(): Promise<void> {
  const folderPath = await resolveCurrentWorkspaceFolder();
  if (!folderPath) return;
  const { bffUrl } = getActoriumConfig();

  type Target = AgentTarget | 'generic';
  const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { target: Target }>(
    [
      { label: '$(terminal) Claude Code', description: 'via `claude mcp add`', target: 'claude' },
      { label: '$(terminal) Codex', description: 'via `codex mcp add`', target: 'codex' },
      { label: '$(json) opencode', description: 'writes opencode.json', target: 'opencode' },
      {
        label: '$(copy) Copy config (any other MCP client)',
        description: 'copies a standard mcpServers JSON snippet to the clipboard',
        target: 'generic',
      },
    ],
    { title: 'Add Actorium MCP to a local agent' },
  );
  if (!picked) return;

  if (picked.target === 'generic') {
    await vscode.env.clipboard.writeText(genericMcpConfigSnippet(bffUrl));
    vscode.window.showInformationMessage(
      "Actorium: MCP config copied to clipboard — paste it into your tool's MCP configuration.",
    );
    return;
  }

  const result = await connectAgentByTarget(picked.target, folderPath, bffUrl);
  if (result.ok) {
    vscode.window.showInformationMessage(`Actorium: ${result.message}`);
  } else {
    vscode.window.showErrorMessage(`Actorium: ${result.message}`);
  }
}

interface AccountMenuItem extends vscode.QuickPickItem {
  action?: 'profile' | 'signout';
}

async function showAccountMenu(): Promise<void> {
  const token = await authManager.getToken();
  if (!token) {
    await authManager.startDeviceFlow();
    return;
  }

  const profile = authManager.getUserProfile();
  const name = profile?.display_name || profile?.email || 'Actorium account';

  const items: AccountMenuItem[] = [
    { label: '$(gear) Profile settings', action: 'profile' },
    { label: '$(sign-out) Sign out', action: 'signout' },
  ];

  const picked = await vscode.window.showQuickPick(items, { placeHolder: name });
  if (picked?.action === 'profile') {
    const { frontendUrl } = getActoriumConfig();
    vscode.env.openExternal(vscode.Uri.parse(`${frontendUrl}/settings/profile`));
  } else if (picked?.action === 'signout') {
    vscode.commands.executeCommand('actorium.disconnect');
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // ── 1. Initialize modules ───────────────────────────────────────────────
  extContext = context;
  authManager = new AuthManager(context);
  versionChecker = new VersionChecker(context);

  // Recover a selection stashed just before this window reloaded into a new
  // folder (see syncWindowToWorkspace) — overrides the constructor's
  // per-folder-restored selection if it's stale for the folder now open.
  void consumePendingWorkspaceSync(
    context,
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  ).then((pending) => {
    if (pending) {
      void authManager
        .applyPendingWorkspaceSelection(pending.workspaceId, pending.workspaceLabel, pending.orgId)
        .then(() => navigatorProvider?.setWorkspaceLabel(authManager.getWorkspaceLabel()));
    }
  });

  const docContentProvider = new DocContentProvider();

  const codingApiCtx = {
    getToken: () => authManager.getToken(),
    getWorkspaceId: () => authManager.getWorkspaceId(),
  };

  navigatorProvider = new NavigatorPanelProvider(
    context,
    codingApiCtx,
    docContentProvider,
    () => authManager.getWorkspaceId(),
    versionChecker,
    regenerateAgentsFile,
  );

  authManager.onConnected(() => {
    navigatorProvider?.setConnected(true);
    // First-time connect: prompt for org → workspace right away rather than
    // waiting for the user to discover "Switch Workspace".
    if (!authManager.getWorkspaceId()) {
      void authManager.switchWorkspace();
    }
  });
  authManager.onDisconnected(() => {
    navigatorProvider?.setConnected(false);
  });
  authManager.onWorkspaceChanged((label) => {
    navigatorProvider?.setWorkspaceLabel(label);
    const workspaceId = authManager.getWorkspaceId();
    if (workspaceId) void syncWindowToWorkspace(workspaceId);
  });
  authManager.onProfileChanged((profile) => navigatorProvider?.setUserProfile(profile));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('actorium.navigatorPanel', navigatorProvider),
    vscode.workspace.registerTextDocumentContentProvider(ACTORIUM_DOC_SCHEME, docContentProvider),
  );

  // ── 2. Commands ─────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('actorium.connect', () => authManager.startDeviceFlow()),
    vscode.commands.registerCommand('actorium.disconnect', () => authManager.disconnect()),
    vscode.commands.registerCommand('actorium.switchWorkspace', () =>
      authManager.switchWorkspace(),
    ),
    vscode.commands.registerCommand('actorium.checkVersion', () => versionChecker.checkNow()),
    vscode.commands.registerCommand('actorium.showAccountMenu', () => showAccountMenu()),
    vscode.commands.registerCommand('actorium.openWorkspaceFolder', async () => {
      const folderPath = await resolveCurrentWorkspaceFolder();
      if (!folderPath) return;
      await openWorkspaceFolderInThisWindow(folderPath);
    }),
    vscode.commands.registerCommand('actorium.addRepo', async () => {
      const folderPath = await resolveCurrentWorkspaceFolder();
      if (!folderPath) return;
      const workspaceId = authManager.getWorkspaceId();
      const workspaceRepos = workspaceId
        ? await getWorkspaceRepos(codingApiConfig(codingApiCtx), workspaceId)
        : null;
      const workspaceRepoIds = (workspaceRepos ?? []).map((r) => r.repo_id);
      const repos = await addRepo(folderPath, workspaceRepoIds);
      if (repos.length === 0) return;
      await regenerateAgentsFile(folderPath);
      vscode.window.showInformationMessage(
        repos.length === 1
          ? `Actorium: Linked "${repos[0]?.name}".`
          : `Actorium: Linked ${repos.length} repos (${repos.map((r) => r.name).join(', ')}).`,
      );
    }),
    vscode.commands.registerCommand('actorium.addMcpServer', () => addMcpServer()),
    // Target-specific connect/disconnect — used by the Navigator webview's
    // per-agent status rows, which already know which agent they're acting
    // on (unlike actorium.addMcpServer's Command-Palette picker).
    vscode.commands.registerCommand('actorium.connectAgentTarget', async (target: AgentTarget) => {
      const folderPath = await resolveCurrentWorkspaceFolder();
      if (!folderPath) return;
      const { bffUrl } = getActoriumConfig();
      const result = await connectAgentByTarget(target, folderPath, bffUrl);
      if (!result.ok) vscode.window.showErrorMessage(`Actorium: ${result.message}`);
      return result;
    }),
    vscode.commands.registerCommand(
      'actorium.disconnectAgentTarget',
      async (target: AgentTarget) => {
        const folderPath = await resolveCurrentWorkspaceFolder();
        if (!folderPath) return;
        const result = await disconnectAgentByTarget(target, folderPath);
        if (!result.ok) vscode.window.showErrorMessage(`Actorium: ${result.message}`);
        return result;
      },
    ),
    vscode.commands.registerCommand('actorium.openAgentCli', async (target: AgentTarget) => {
      const folderPath = await resolveCurrentWorkspaceFolder();
      if (!folderPath) return;
      openAgentCli(target, folderPath);
    }),
  );

  // ── 2b. URI handler — the device-authorize page in digital-factory-ui can
  // deep-link back here (vscode://<publisher>.<name>/connected) after the
  // user approves in the browser. The token itself never travels through
  // this URI (it's never put in a URL) — AuthManager's polling in
  // startDeviceFlow is what actually completes the connection; this handler
  // only brings the window into focus and gives immediate feedback instead
  // of waiting for the next poll tick.
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path === '/connected') {
          vscode.window.showInformationMessage(
            'Actorium: Authorization approved in browser — connecting…',
          );
        }
      },
    }),
  );

  // ── 3. Connect on activation if token exists ────────────────────────────
  authManager.autoConnect().then((connected) => {
    if (connected) {
      navigatorProvider?.setConnected(true);
      // The workspace ID/label were already restored into authManager's
      // constructor from globalState, but nothing pushes that into the
      // navigator's own state (read by _syncState() on the webview's 'ready'
      // handshake) until a workspace change actually happens — without
      // this, a reload leaves the pill stuck on "Select workspace" even
      // though a real workspace is already selected and in use.
      navigatorProvider?.setWorkspaceLabel(authManager.getWorkspaceLabel());
    }
  });

  // ── 3a. Environment switch → logout + refresh ───────────────────────────
  // actorium.environment picks an entirely different server (different
  // bffUrl/clientId — see config/environment.ts's ENVIRONMENTS map), so a
  // token/workspace/org obtained under the OLD environment is meaningless
  // (at best rejected outright, at worst — if two environments happened to
  // share a compatible auth backend — silently pointed at the wrong org's
  // data). disconnect() clears the stored token/workspace/org and fires
  // onDisconnected, which already resets the navigator's connected state —
  // the same "logout and refresh" sequence as clicking Sign out, just
  // triggered by the settings change instead of a menu click. Deliberately
  // does NOT auto-reconnect: a different server means a real re-login, not
  // a silent retry.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('actorium.environment')) {
        void authManager.disconnect();
      }
    }),
  );

  // ── 4. Version check ────────────────────────────────────────────────────
  versionChecker.onBlocked((entry) => {
    navigatorProvider?.setVersionBlocked(entry);
  });
  versionChecker.autoCheck();
}

export function deactivate(): void {
  versionChecker?.dispose();
}
