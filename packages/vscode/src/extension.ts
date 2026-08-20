import type { AccountSummary } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { AuthManager } from './auth/oauth.js';
import {
  type ActoriumEnvironment,
  configForEnvironment,
  ENVIRONMENTS,
  getActoriumConfig,
  getSelectedEnvironment,
  initEnvironmentStore,
  setSelectedEnvironment,
} from './config/environment.js';
import { ACTORIUM_DOC_SCHEME, DocContentProvider } from './navigator/doc-content-provider.js';
import { NavigatorPanelProvider } from './navigator/panel.js';
import { codingApiConfig, getWorkspaceRepos } from './navigator/workflow-api.js';
import { VersionChecker } from './version/checker.js';
import { writeAgentsFile } from './workspace/agentsFile.js';
import { ensureEnvFile, ensureEnvGitignored } from './workspace/envFile.js';
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
import { readBundledSharedRules, writeWorkflowRules } from './workspace/workflowRules.js';
import { writeWorkspaceManifest } from './workspace/workspaceManifest.js';
import { ensureWorkspaceRulesFile } from './workspace/workspaceRulesFile.js';

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

/** Regenerates AGENTS.md, the .actorium/workspace.json manifest, and the
 * bundled workflow skills at the workspace folder's root from the
 * current org/workspace state — called after every repo add/clone/unlink so
 * the files an agent (or actorium-mcp itself, for the manifest — see
 * workspaceManifest.ts) reads always reflect what's actually linked/
 * selected. AGENTS.md itself no longer needs the linked-repo list threaded
 * in — it just points at .actorium/repo-links.json (see agentsFile.ts),
 * which repoLinker.ts/repoLinkManifest.ts keep current on every repo-state
 * change directly. Also ensures a blank `.env` (gitignored) and a
 * `WORKSPACE-RULES.md` exist at the folder root (see envFile.ts /
 * workspaceRulesFile.ts) — both are create-once and never overwritten, so
 * user-filled tokens or hand-written rules are never clobbered by a later
 * regeneration. The bundled shared.md content (see workflowRules.ts) is
 * embedded directly in AGENTS.md's generated section, not just linked to —
 * a separate file is easy to skip, but every agent reads AGENTS.md. */
async function regenerateAgentsFile(folderPath: string): Promise<void> {
  const names = parseWorkspaceLabel(authManager.getWorkspaceLabel());
  const workspaceId = authManager.getWorkspaceId();
  const orgId = authManager.getOrgId();
  if (!names || !workspaceId) return;
  const sharedRulesMarkdown = await readBundledSharedRules(extContext);
  await writeAgentsFile(folderPath, { ...names, workspaceId }, sharedRulesMarkdown);
  if (orgId) await writeWorkspaceManifest(folderPath, { workspaceId, orgId });
  await writeWorkflowRules(extContext, folderPath);
  await ensureEnvFile(folderPath);
  await ensureEnvGitignored(folderPath);
  await ensureWorkspaceRulesFile(folderPath);
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
    authManager.getBffUrl(),
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
  if (!workspaceId || getWorkspaceFolder(extContext, authManager.getBffUrl(), workspaceId)) return;
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
  const bffUrl = authManager.getBffUrl();
  const folderPath = getWorkspaceFolder(extContext, bffUrl, workspaceId);
  if (!folderPath) {
    await promptLinkWorkspaceFolderIfNeeded();
    return;
  }

  const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (currentFolder === folderPath) return;

  // About to reload into a different folder — stash the selection we just
  // made (including which account made it — org/workspace selection is now
  // account-scoped, and a brand-new folder has no activeAccountId::<bffUrl>
  // pointer yet for autoConnect() to restore from) so the reactivated
  // extension can recover it. Without this, the reload restores whatever
  // selection was last associated with *that* folder specifically
  // (workspaceState is per-folder), which can be a stale, unrelated
  // workspace rather than the one just picked.
  const workspaceLabel = authManager.getWorkspaceLabel();
  const accountId = authManager.getActiveAccountId();
  if (workspaceLabel && accountId) {
    await stashPendingWorkspaceSync(extContext, {
      folderPath,
      accountId,
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
  const bffUrl = authManager.getBffUrl();

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

interface ServerItem extends vscode.QuickPickItem {
  environment?: ActoriumEnvironment;
  isCustomAction?: boolean;
}

/** The only server surfaced as a list item — every other environment (local, abp, sw, …) is
 * reached via "Select custom server" (promptCustomServer, below) instead, so their names stay
 * out of a picker anyone browsing the command could otherwise see. */
const LISTED_SERVERS: ReadonlyArray<{
  label: string;
  description: string;
  environment: ActoriumEnvironment;
}> = [
  { label: 'Production', description: 'Connect to Actorium Production', environment: 'production' },
];

/** Environment names not in LISTED_SERVERS — only these are accepted by promptCustomServer. */
const TYPEABLE_ENVIRONMENTS = (Object.keys(ENVIRONMENTS) as ActoriumEnvironment[]).filter(
  (env) => !LISTED_SERVERS.some((item) => item.environment === env),
);

/**
 * Prompts for a non-Production server by name — kept behind its own step
 * (rather than listed alongside Production in selectServer() below) so
 * internal environment names aren't visible to someone just browsing the
 * picker. Returns undefined if the user cancels.
 */
async function promptCustomServer(
  current: ActoriumEnvironment,
): Promise<ActoriumEnvironment | undefined> {
  const input = await vscode.window.showInputBox({
    title: 'Connect to a custom Actorium server',
    prompt: 'Server name',
    value: TYPEABLE_ENVIRONMENTS.includes(current) ? current : '',
  });
  if (input === undefined) return undefined;

  const trimmed = input.trim().toLowerCase();
  if (!TYPEABLE_ENVIRONMENTS.includes(trimmed as ActoriumEnvironment)) {
    void vscode.window.showErrorMessage(`Actorium: Unknown server "${input}".`);
    return undefined;
  }
  return trimmed as ActoriumEnvironment;
}

/**
 * Prompts for which Actorium server to connect to, with NO side effects
 * (doesn't touch the globally-selected environment or re-scope AuthManager)
 * — this used to be the `actorium.environment` Settings entry; it's now an
 * explicit step shown right before a device flow starts instead of a
 * setting a user has to go dig up. Only Production is listed; everything
 * else is reached through "Select custom server" and its own input box (see
 * promptCustomServer above). Returns undefined if the user cancels either
 * step.
 */
async function promptForEnvironment(): Promise<ActoriumEnvironment | undefined> {
  const current = getSelectedEnvironment();
  const isCustomCurrent = !LISTED_SERVERS.some((item) => item.environment === current);
  const items: ServerItem[] = [
    ...LISTED_SERVERS.map((item) => ({
      ...item,
      label: item.environment === current ? `$(check) ${item.label}` : item.label,
    })),
    {
      label: isCustomCurrent ? '$(check) Select custom server…' : 'Select custom server…',
      description: isCustomCurrent ? `Currently: ${current}` : 'Custom Actorium servers',
      isCustomAction: true,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, { title: 'Connect to Actorium' });
  if (!picked) return undefined;

  return picked.isCustomAction ? await promptCustomServer(current) : picked.environment;
}

/**
 * Server picker, then re-scopes AuthManager to whatever session (if any)
 * already exists for the picked backend — the plain "Connect" flow. Returns
 * false if the user cancels, so callers can abort the login instead of
 * proceeding with whatever was previously selected.
 */
async function selectServer(): Promise<boolean> {
  const environment = await promptForEnvironment();
  if (!environment) return false;

  await setSelectedEnvironment(environment);
  await authManager.switchEnvironment(getActoriumConfig().bffUrl);
  return true;
}

/** Server picker, then device flow — the full "select server before login" flow. */
async function connectWithServerSelection(): Promise<void> {
  const selected = await selectServer();
  if (!selected) return;
  await authManager.startDeviceFlow();
}

/**
 * Adds a second (or later) account without touching whichever account is
 * currently active in this window — unlike connectWithServerSelection()
 * above, this deliberately does NOT call selectServer()/switchEnvironment(),
 * since re-scoping AuthManager to the picked backend would silently flip the
 * window's active account to whatever session already exists there (if any)
 * the instant the environment is chosen, disturbing the account the user was
 * already on. Resolves the picked environment's fixed defaults directly
 * (configForEnvironment), ignoring any actorium.bffUrl/frontendUrl/clientId
 * settings.json override — that override only makes sense as "override the
 * currently-selected environment," not as a silent override of an
 * explicitly-picked new account's backend.
 *
 * Called right after another QuickPick just resolved (switchAccountMenu()'s
 * "Add another account…" row) as well as directly (the webview's "Add
 * account" button, via the actorium.addAccount command) — the former can
 * flash-and-instantly-dismiss the environment QuickPick below if it's shown
 * before VS Code has fully torn down the one that just closed, so this
 * yields a tick first. Harmless when there was no preceding QuickPick.
 */
async function addAnotherAccount(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const environment = await promptForEnvironment();
  if (!environment) return;
  const { bffUrl, frontendUrl, clientId } = configForEnvironment(environment);
  await authManager.startDeviceFlowForNewAccount(bffUrl, frontendUrl, clientId);
}

interface SwitchAccountItem extends vscode.QuickPickItem {
  accountId?: string;
  isAddAccount?: boolean;
}

/** QuickPick over every stored account, grouped by environment, plus an
 * "Add another account" row — the account switcher's native entry point,
 * also reachable from the webview's user menu via the `actorium.switchAccount`
 * command (see panel.ts). Switching to an existing row is instant (no
 * re-auth, see AuthManager.switchAccount); picking "Add another account"
 * hands off to addAnotherAccount() above. */
async function switchAccountMenu(): Promise<void> {
  const accounts = authManager.listAccounts();

  const byEnvironment = new Map<string, AccountSummary[]>();
  for (const account of accounts) {
    const bucket = byEnvironment.get(account.environmentLabel) ?? [];
    bucket.push(account);
    byEnvironment.set(account.environmentLabel, bucket);
  }

  const items: SwitchAccountItem[] = [];
  for (const [environmentLabel, group] of byEnvironment) {
    items.push({ label: environmentLabel, kind: vscode.QuickPickItemKind.Separator });
    for (const account of group) {
      items.push({
        label:
          (account.isActive ? '$(check) ' : '') + (account.user.display_name || account.user.email),
        description: account.workspaceLabel ?? account.user.email,
        detail: account.environmentLabel,
        accountId: account.id,
      });
    }
  }
  items.push({ label: '$(add) Add another account…', isAddAccount: true });

  const picked = await vscode.window.showQuickPick(items, { title: 'Actorium: Switch Account' });
  if (!picked) return;

  if (picked.isAddAccount) {
    await addAnotherAccount();
  } else if (picked.accountId) {
    await authManager.switchAccount(picked.accountId);
  }
}

interface AccountMenuItem extends vscode.QuickPickItem {
  action?: 'profile' | 'switchAccount' | 'signout';
}

async function showAccountMenu(): Promise<void> {
  const token = await authManager.getToken();
  if (!token) {
    await connectWithServerSelection();
    return;
  }

  const profile = authManager.getUserProfile();
  const name = profile?.display_name || profile?.email || 'Actorium account';

  const items: AccountMenuItem[] = [
    { label: '$(gear) Profile settings', action: 'profile' },
    { label: '$(account) Switch account', action: 'switchAccount' },
    { label: '$(sign-out) Sign out', action: 'signout' },
  ];

  const picked = await vscode.window.showQuickPick(items, { placeHolder: name });
  if (picked?.action === 'profile') {
    const frontendUrl = authManager.getFrontendUrl();
    if (frontendUrl) vscode.env.openExternal(vscode.Uri.parse(`${frontendUrl}/settings/profile`));
  } else if (picked?.action === 'switchAccount') {
    await switchAccountMenu();
  } else if (picked?.action === 'signout') {
    vscode.commands.executeCommand('actorium.disconnect');
  }
}

/** Native "Reconnect?" nudge shown once when the active account's session
 * transitions to expired (see AuthManager.onSessionExpired) — re-authenticates
 * the SAME account in place via reconnectActiveAccount(), not a fresh login. */
function showSessionExpiredPrompt(): void {
  const profile = authManager.getUserProfile();
  const name = profile?.display_name || profile?.email || 'your account';
  vscode.window
    .showWarningMessage(`Actorium: Your session for ${name} has expired.`, 'Reconnect')
    .then((choice) => {
      if (choice === 'Reconnect') void authManager.reconnectActiveAccount();
    });
}

/** Re-derives the active account's session state (renewing silently if the
 * token is near expiry — see AuthManager.checkExpiry) and mirrors the result
 * into the webview. Passed into NavigatorPanelProvider so its existing poll
 * loop (panel.ts, already ticking every 30s while the sidebar is visible)
 * doubles as the safety net for a machine resumed from sleep, where
 * AuthManager's own renewal timer was frozen while the clock ran on. */
function checkSessionExpiry(): void {
  authManager.checkExpiry();
  navigatorProvider?.setSessionExpired(authManager.isSessionExpired());
}

export function activate(context: vscode.ExtensionContext): void {
  // ── 1. Initialize modules ───────────────────────────────────────────────
  extContext = context;
  initEnvironmentStore(context);
  authManager = new AuthManager(context, getActoriumConfig().bffUrl);
  versionChecker = new VersionChecker(context);

  const docContentProvider = new DocContentProvider();

  const codingApiCtx = {
    getToken: () => authManager.getToken(),
    getWorkspaceId: () => authManager.getWorkspaceId(),
    getBffUrl: () => authManager.getBffUrl(),
    onUnauthorized: () => authManager.reportUnauthorized(),
  };

  navigatorProvider = new NavigatorPanelProvider(
    context,
    codingApiCtx,
    docContentProvider,
    () => authManager.getWorkspaceId(),
    versionChecker,
    regenerateAgentsFile,
    () => authManager.getFrontendUrl(),
    checkSessionExpiry,
  );

  authManager.onConnected(() => {
    navigatorProvider?.setConnected(true);
    navigatorProvider?.setAccounts(authManager.listAccounts());
    navigatorProvider?.setSessionExpired(authManager.isSessionExpired());
    // First-time connect: prompt for org → workspace right away rather than
    // waiting for the user to discover "Switch Workspace".
    if (!authManager.getWorkspaceId()) {
      void authManager.switchWorkspace();
    }
  });
  authManager.onDisconnected(() => {
    navigatorProvider?.setConnected(false);
    navigatorProvider?.setAccounts(authManager.listAccounts());
    navigatorProvider?.setSessionExpired(authManager.isSessionExpired());
  });
  authManager.onWorkspaceChanged((label) => {
    navigatorProvider?.setWorkspaceLabel(label);
    navigatorProvider?.setAccounts(authManager.listAccounts());
    navigatorProvider?.setSessionExpired(authManager.isSessionExpired());
    const workspaceId = authManager.getWorkspaceId();
    if (workspaceId) void syncWindowToWorkspace(workspaceId);
  });
  authManager.onProfileChanged((profile) => {
    navigatorProvider?.setUserProfile(profile);
    navigatorProvider?.setAccounts(authManager.listAccounts());
    navigatorProvider?.setSessionExpired(authManager.isSessionExpired());
  });
  // One-shot nudge on the valid→expired transition (see AuthManager's
  // onSessionExpired doc comment) — the webview banner itself is kept in
  // sync via isSessionExpired() reads above, not this callback, since this
  // fires only once per expiry and the banner needs to reflect the current
  // state on every subsequent connect/switch too.
  authManager.onSessionExpired(() => showSessionExpiredPrompt());
  // The inverse transition: another window renewed the shared token, so the
  // banner this window is showing is stale (see AuthManager.onSessionRestored).
  // Silent on purpose — nothing was asked of the user, so nothing needs saying.
  authManager.onSessionRestored(() => navigatorProvider?.setSessionExpired(false));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('actorium.navigatorPanel', navigatorProvider),
    vscode.workspace.registerTextDocumentContentProvider(ACTORIUM_DOC_SCHEME, docContentProvider),
    // Owns a renewal timer and a SecretStorage listener now, so it has to be
    // torn down on reload rather than left firing against a dead instance.
    authManager,
  );

  // ── 2. Commands ─────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('actorium.connect', () => connectWithServerSelection()),
    vscode.commands.registerCommand('actorium.disconnect', () => authManager.disconnect()),
    vscode.commands.registerCommand('actorium.switchWorkspace', () =>
      authManager.switchWorkspace(),
    ),
    vscode.commands.registerCommand('actorium.checkVersion', () => versionChecker.checkNow()),
    vscode.commands.registerCommand('actorium.showAccountMenu', () => showAccountMenu()),
    // Command-palette invocation (no args) shows the QuickPick; the webview's
    // user menu passes a specific accountId to switch directly, since it
    // already shows an explicit clickable list rather than a picker.
    vscode.commands.registerCommand('actorium.switchAccount', (accountId?: string) =>
      accountId ? authManager.switchAccount(accountId) : switchAccountMenu(),
    ),
    vscode.commands.registerCommand('actorium.addAccount', () => addAnotherAccount()),
    vscode.commands.registerCommand('actorium.reconnectAccount', () =>
      authManager.reconnectActiveAccount(),
    ),
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
      const bffUrl = authManager.getBffUrl();
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

  // ── 3. Recover a pending workspace-switch reload, else connect on
  // activation if a stored account exists ────────────────────────────────
  // Must run in this order: consumePendingWorkspaceSync() recovers a
  // selection stashed just before this window reloaded into a new folder
  // (see syncWindowToWorkspace) — a BRAND-NEW folder has no
  // activeAccountId::<bffUrl> pointer yet for autoConnect() to restore from
  // on its own, even though the reload was triggered by an already-active
  // account. Skip autoConnect() entirely when a pending sync was consumed —
  // applyPendingWorkspaceSelection() already activates that account and
  // fires onConnected/onProfileChanged/onWorkspaceChanged, which push
  // connected/workspace/account state to navigatorProvider on their own.
  void (async () => {
    const pending = await consumePendingWorkspaceSync(
      context,
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    );
    if (pending) {
      await authManager.applyPendingWorkspaceSelection(
        pending.accountId,
        pending.workspaceId,
        pending.workspaceLabel,
        pending.orgId,
      );
      return;
    }

    const connected = await authManager.autoConnect();
    if (connected) {
      navigatorProvider?.setConnected(true);
      // autoConnect() deliberately doesn't fire onConnected/onProfileChanged/
      // onWorkspaceChanged (see its doc comment), so nothing else pushes this
      // restored state into the navigator's own state (read by _syncState()
      // on the webview's 'ready' handshake) until a workspace change/account
      // switch actually happens — without this, a reload leaves the pill
      // stuck on "Select workspace" even though a real workspace is already
      // selected and in use.
      navigatorProvider?.setWorkspaceLabel(authManager.getWorkspaceLabel());
      navigatorProvider?.setUserProfile(authManager.getUserProfile());
      navigatorProvider?.setAccounts(authManager.listAccounts());
      navigatorProvider?.setSessionExpired(authManager.isSessionExpired());
    }
  })();

  // ── 3a. Advanced bffUrl override → re-scope to the new backend ─────────
  // Normal server selection now goes through selectServer() (which calls
  // switchEnvironment() itself — see above), but `actorium.bffUrl` remains
  // an undocumented settings.json override for pointing at an arbitrary
  // backend without going through the four fixed environments. AuthManager
  // keys its token/workspace-org selection/credential file by bffUrl (see
  // oauth.ts), so switchEnvironment() here just repoints this window at
  // whichever session (if any) already exists for the new backend — it does
  // NOT disconnect, and critically does NOT touch any other backend's or
  // window's stored session.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('actorium.bffUrl')) {
        void authManager.switchEnvironment(getActoriumConfig().bffUrl);
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
  authManager?.dispose();
}
