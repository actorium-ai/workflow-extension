import type { MeUser, VersionEntry } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { getActoriumConfig } from '../config/environment.js';
import { compareVersions, type VersionChecker } from '../version/checker.js';
import { buildWebviewHtml } from '../webview-html.js';
import { getWorkspaceFolder } from '../workspace/folderManager.js';
import {
  type AgentTarget,
  DEFAULT_MCP_NPM_PACKAGE,
  getClaudeCodeStatus,
  getCodexStatus,
  getMcpCliStatus,
  getOpencodeStatus,
  installMcpCli,
} from '../workspace/mcpConnect.js';
import {
  cloneAllRepos,
  cloneRepo,
  listLinkedRepos,
  removeBrokenLink,
  unlinkRepo,
} from '../workspace/repoLinker.js';
import { readRepoLinkManifest, repairRepoLinkManifest } from '../workspace/repoLinkManifest.js';
import {
  getTechnicalSkillsStatus,
  installTechnicalSkills,
  uninstallTechnicalSkills,
} from '../workspace/technicalSkills.js';
import { DocContentProvider } from './doc-content-provider.js';
import { FeatureDetailPanel } from './feature-detail-panel.js';
import { FeaturesBrowserPanel } from './features-browser-panel.js';
import { openWorkspaceDocument } from './open-document.js';
import {
  codingApiConfig,
  type CodingApiContext,
  getWorkspaceRepos,
  listDocuments,
  listFeatures,
} from './workflow-api.js';

/** How often docs/features are re-polled while the sidebar is visible —
 * cheap workspace-scoped list reads, so a short interval is fine and keeps
 * changes made elsewhere (another IDE window, the web app, an agent task)
 * showing up without the user having to switch views to trigger a refetch. */
const DOCS_FEATURES_POLL_INTERVAL_MS = 30_000;

/**
 * Navigator panel provider — manages the extension's one webview (primary
 * sidebar), listing the current workspace's documents, features, and linked
 * local repos.
 */
export class NavigatorPanelProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;
  private _connected = false;
  private _workspaceLabel: string | null = null;
  private _userProfile: MeUser | null = null;
  private _versionBlockedEntry: VersionEntry | null = null;
  private _pollInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly codingApiCtx: CodingApiContext,
    private readonly docContentProvider: DocContentProvider,
    private readonly getWorkspaceId: () => string | null,
    private readonly versionChecker: VersionChecker,
    private readonly regenerateAgentsFile: (folderPath: string) => Promise<void>,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist')],
    };

    webviewView.webview.html = buildWebviewHtml(this.context, webviewView.webview);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this._loadDocs();
        void this._loadFeatures();
      }
    });

    // Belt-and-suspenders alongside the visibility refetch above: catches
    // changes made elsewhere while the user is just sitting on this view
    // (e.g. reading Docs) without ever triggering a re-show.
    this._pollInterval = setInterval(() => {
      if (webviewView.visible && this._connected && this._workspaceLabel) {
        void this._loadDocs();
        void this._loadFeatures();
      }
    }, DOCS_FEATURES_POLL_INTERVAL_MS);
    webviewView.onDidDispose(() => {
      if (this._pollInterval) {
        clearInterval(this._pollInterval);
        this._pollInterval = null;
      }
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'connect':
          vscode.commands.executeCommand('actorium.connect');
          break;

        case 'switchWorkspace':
          vscode.commands.executeCommand('actorium.switchWorkspace');
          break;

        case 'signOut':
          vscode.commands.executeCommand('actorium.disconnect');
          break;

        case 'openProfileSettings': {
          const { frontendUrl } = getActoriumConfig();
          vscode.env.openExternal(vscode.Uri.parse(`${frontendUrl}/settings/profile`));
          break;
        }

        case 'listDocs':
          await this._loadDocs();
          break;

        case 'listFeatures':
          await this._loadFeatures();
          break;

        case 'openDocument':
          await openWorkspaceDocument(message.doc, this.codingApiCtx, this.docContentProvider);
          break;

        case 'openFeatureDetail':
          FeatureDetailPanel.createOrShow(this.context, this.codingApiCtx, message.feature);
          break;

        case 'openFeaturesBrowser':
          FeaturesBrowserPanel.createOrShow(this.context, this.codingApiCtx);
          break;

        case 'tagInPrompt':
          this._tagInPrompt(message.text);
          break;

        case 'openMarketplace':
          vscode.env.openExternal(vscode.Uri.parse(message.url));
          break;

        case 'listRepos':
          await this._loadRepos();
          break;

        case 'addRepo':
          await vscode.commands.executeCommand('actorium.addRepo');
          await this._loadRepos();
          break;

        case 'unlinkRepo':
          await this._unlinkRepo(message.name);
          break;

        case 'cloneRepo':
          await this._cloneRepo(message.url, message.name);
          break;

        case 'cloneAllRepos':
          await this._cloneAllRepos();
          break;

        case 'repairWorkspace':
          await this._repairWorkspace();
          break;

        case 'listMcpStatus':
          await this._loadMcpStatus();
          break;

        case 'connectAgent':
          await vscode.commands.executeCommand('actorium.connectAgentTarget', message.target);
          await this._loadMcpStatus();
          break;

        case 'disconnectAgent':
          await vscode.commands.executeCommand('actorium.disconnectAgentTarget', message.target);
          await this._loadMcpStatus();
          break;

        case 'openAgentCli':
          await vscode.commands.executeCommand('actorium.openAgentCli', message.target);
          break;

        case 'getMcpCliStatus':
          await this._loadMcpCliStatus();
          break;

        case 'installMcpCli':
          await this._installMcpCli();
          break;

        case 'getTechnicalSkillsStatus':
          await this._loadTechnicalSkillsStatus(message.target);
          break;

        case 'installTechnicalSkills':
          await this._installTechnicalSkills(message.target);
          break;

        case 'uninstallTechnicalSkills':
          await this._uninstallTechnicalSkills(message.target);
          break;

        case 'openWorkspaceFolder':
          vscode.commands.executeCommand('actorium.openWorkspaceFolder');
          break;

        case 'ready':
          this._syncState();
          break;
      }
    });
  }

  /**
   * Inserts a plain-text reference into whatever terminal the user is
   * mid-typing a prompt into (a coding agent CLI session) — not a structured
   * mention, just a hint the agent can resolve with its own MCP tools
   * (get_feature by name, read_storage_document by path, etc). Falls back to
   * the clipboard when no terminal is focused, since `sendText` has nowhere
   * to go otherwise.
   */
  private async _tagInPrompt(text: string): Promise<void> {
    const terminal = vscode.window.activeTerminal;
    if (terminal) {
      terminal.show(true);
      terminal.sendText(text, false);
      return;
    }
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(
      `Actorium: No active terminal — copied "${text}" to clipboard instead.`,
    );
  }

  private async _loadDocs(): Promise<void> {
    const workspaceId = this.codingApiCtx.getWorkspaceId();
    const docs = workspaceId
      ? await listDocuments(codingApiConfig(this.codingApiCtx), workspaceId)
      : null;
    this._postMessage({ command: 'docsLoaded', docs: docs ?? [] });
  }

  private async _loadFeatures(): Promise<void> {
    const workspaceId = this.codingApiCtx.getWorkspaceId();
    const features = workspaceId
      ? await listFeatures(codingApiConfig(this.codingApiCtx), workspaceId)
      : null;
    this._postMessage({ command: 'featuresLoaded', features: features ?? [] });
  }

  private async _loadRepos(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
    const [linked, workspaceRepos, repoLinkManifest] = await Promise.all([
      folder ? listLinkedRepos(folder) : Promise.resolve([]),
      workspaceId
        ? getWorkspaceRepos(codingApiConfig(this.codingApiCtx), workspaceId)
        : Promise.resolve(null),
      folder ? readRepoLinkManifest(folder) : Promise.resolve<Record<string, string>>({}),
    ]);

    const linkedByRepoId = new Map(
      linked.map((r) => [(repoLinkManifest[r.name] ?? r.name).toLowerCase(), r]),
    );
    const seen = new Set<string>();
    const repos: {
      name: string;
      target?: string;
      linked: boolean;
      repoUrl?: string;
      linkName?: string;
      isSymlink?: boolean;
      broken?: boolean;
    }[] = [];

    for (const wr of workspaceRepos ?? []) {
      const key = wr.repo_id.toLowerCase();
      const local = linkedByRepoId.get(key);
      seen.add(key);
      repos.push({
        name: wr.repo_id,
        target: local?.target,
        linked: !!local,
        repoUrl: wr.repo_url ?? undefined,
        linkName: local && local.name.toLowerCase() !== key ? local.name : undefined,
        isSymlink: local?.isSymlink,
        broken: local?.broken,
      });
    }
    // Any locally-linked repo the workspace API doesn't know about (linked
    // before being registered workspace-side, or an unrelated folder) still
    // shows up, same as before this cross-reference existed.
    for (const r of linked) {
      const repoId = (repoLinkManifest[r.name] ?? r.name).toLowerCase();
      if (!seen.has(repoId)) {
        repos.push({
          name: r.name,
          target: r.target,
          linked: true,
          isSymlink: r.isSymlink,
          broken: r.broken,
        });
      }
    }

    this._postMessage({ command: 'reposLoaded', repos, hasWorkspaceFolder: !!folder });
  }

  /** Confirms (destructive-adjacent — removes a symlink, though the real
   * clone it points to is untouched) then removes a repo's symlink from the
   * workspace folder. Refreshes AGENTS.md/manifest and the repo list on
   * success, same as every other repo-state-changing op. */
  private async _unlinkRepo(name: string): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
    if (!folder) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Unlink "${name}" from this workspace? The local clone won't be deleted.`,
      { modal: true },
      'Unlink',
    );
    if (confirmed !== 'Unlink') return;

    const result = await unlinkRepo(folder, name);
    if (!result.ok) {
      vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    } else {
      await this.regenerateAgentsFile(folder);
    }
    await this._loadRepos();
  }

  /** Clones a single git URL and links it — the webview's "Clone from git
   * URL" modal (any URL, name optional/derived) and its per-row "Clone"
   * action on a known-but-unlinked workspace repo (explicit name) both land
   * here. Always reports back via `cloneRepoResult` so the modal can show
   * an inline error/success instead of only a toast (a toast is easy to
   * miss on a form that's still open waiting for feedback) — the toast on
   * failure is a backstop for the per-row path, which has no modal open. */
  private async _cloneRepo(url: string, name?: string): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
    if (!folder) {
      this._postMessage({
        command: 'cloneRepoResult',
        ok: false,
        message: 'Link a workspace folder first.',
      });
      return;
    }

    const result = await cloneRepo(folder, url, name);
    if (result.ok) {
      await this.regenerateAgentsFile(folder);
    } else {
      vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    }
    this._postMessage({ command: 'cloneRepoResult', ok: result.ok, message: result.message });
    await this._loadRepos();
  }

  /** Clones every workspace repo that isn't linked yet and has a known
   * repo_url — the section header's "Clone all" action. Reports the batch
   * outcome via a toast (mirroring addRepo's own multi-link summary toast)
   * since there's no modal open for this path to show it inline. */
  private async _cloneAllRepos(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
    if (!folder || !workspaceId) {
      this._postMessage({ command: 'cloneAllReposDone' });
      return;
    }

    const [linked, workspaceRepos] = await Promise.all([
      listLinkedRepos(folder),
      getWorkspaceRepos(codingApiConfig(this.codingApiCtx), workspaceId),
    ]);
    const linkedNames = new Set(linked.map((r) => r.name.toLowerCase()));
    const candidates = (workspaceRepos ?? [])
      .filter((r) => r.repo_url && !linkedNames.has(r.repo_id.toLowerCase()))
      .map((r) => ({ name: r.repo_id, url: r.repo_url as string }));

    if (candidates.length === 0) {
      vscode.window.showInformationMessage(
        'Actorium: Nothing to clone — every repo is already linked.',
      );
      this._postMessage({ command: 'cloneAllReposDone' });
      return;
    }

    const { linked: newlyLinked, failures } = await cloneAllRepos(folder, candidates);
    if (newlyLinked.length > 0) await this.regenerateAgentsFile(folder);

    if (failures.length === 0) {
      vscode.window.showInformationMessage(
        `Actorium: Cloned ${newlyLinked.length} repo${newlyLinked.length === 1 ? '' : 's'}.`,
      );
    } else {
      vscode.window.showWarningMessage(
        `Actorium: Cloned ${newlyLinked.length}, failed ${failures.length}: ${failures
          .map((f) => `${f.name} (${f.message})`)
          .join('; ')}`,
      );
    }
    this._postMessage({ command: 'cloneAllReposDone' });
    await this._loadRepos();
  }

  /** Regenerates repo-links.json, AGENTS.md, and .actorium/workspace.json
   * from current state — the section header's "Repair" action, for when
   * any of these have drifted (hand-edited, corrupted, left over from a
   * renamed/moved workspace) rather than requiring the user to unlink and
   * re-link every repo to fix it. Also cleans up any broken symlink left
   * behind by a repo whose target folder was deleted out from under the
   * workspace: removes the dangling link from disk and drops its now-stale
   * repo-links.json entry (see removeBrokenLink), so those don't linger as
   * permanent "unlink" rows the user can never clear. */
  private async _repairWorkspace(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
    if (!folder || !workspaceId) {
      vscode.window.showWarningMessage('Actorium: Connect and select a workspace first.');
      this._postMessage({ command: 'repairWorkspaceDone' });
      return;
    }

    const [linked, workspaceRepos] = await Promise.all([
      listLinkedRepos(folder),
      getWorkspaceRepos(codingApiConfig(this.codingApiCtx), workspaceId),
    ]);
    const broken = linked.filter((r) => r.broken);
    for (const r of broken) {
      await removeBrokenLink(folder, r.name);
    }
    const healthy = linked.filter((r) => !r.broken);

    const workspaceRepoIds = (workspaceRepos ?? []).map((r) => r.repo_id);
    await repairRepoLinkManifest(
      folder,
      healthy.map((r) => r.name),
      workspaceRepoIds,
    );
    await this.regenerateAgentsFile(folder);

    vscode.window.showInformationMessage(
      broken.length > 0
        ? `Actorium: Repaired repo-links.json, AGENTS.md, and workspace.json — removed ${broken.length} broken link${broken.length === 1 ? '' : 's'} (${broken.map((r) => r.name).join(', ')}).`
        : 'Actorium: Repaired repo-links.json, AGENTS.md, and workspace.json.',
    );
    this._postMessage({ command: 'repairWorkspaceDone' });
    await this._loadRepos();
  }

  /** Passive status check — never prompts to link a workspace folder (unlike
   * the connect/disconnect commands), since this fires automatically on
   * every panel load/refresh and shouldn't surprise the user with a QuickPick
   * just for opening the sidebar. */
  private async _loadMcpStatus(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
    if (!folder) {
      this._postMessage({ command: 'mcpStatusLoaded', statuses: {} });
      return;
    }
    const [claude, codex, opencode] = await Promise.all([
      getClaudeCodeStatus(folder),
      getCodexStatus(folder),
      getOpencodeStatus(folder),
    ]);
    const statuses: Record<AgentTarget, unknown> = { claude, codex, opencode };
    this._postMessage({ command: 'mcpStatusLoaded', statuses });
  }

  /**
   * Checks whether the actorium-mcp CLI itself is installed (separate from
   * per-agent registration, see _loadMcpStatus above) and, if so, compares
   * it against the BFF's version-gate entry — `updateRequired` mirrors the
   * extension's own hard-block model (installed < min_version), just scoped
   * to this one row instead of the whole panel.
   */
  private async _loadMcpCliStatus(): Promise<void> {
    const cli = await getMcpCliStatus();
    const entry = this.versionChecker.getActoriumMcpVersionEntry();
    const npmPackage = entry?.npm_package || DEFAULT_MCP_NPM_PACKAGE;

    const installedVersion = cli.installed ? cli.version : undefined;
    const updateRequired =
      installedVersion !== undefined &&
      !!entry &&
      compareVersions(installedVersion, entry.min_version) < 0;
    const updateAvailable =
      installedVersion !== undefined &&
      !!entry &&
      compareVersions(installedVersion, entry.recommended_version) < 0;

    this._postMessage({
      command: 'mcpCliStatusLoaded',
      status: {
        installed: cli.installed,
        version: cli.version,
        npmPackage,
        updateRequired,
        updateAvailable,
      },
    });
  }

  /** Installs/updates the actorium-mcp CLI via npm, then re-syncs AGENTS.md
   * (see extension.ts's regenerateAgentsFile) so a newly-installed CLI is
   * reflected there too — same "sync after every state change" precedent as
   * addRepo above. */
  private async _installMcpCli(): Promise<void> {
    const entry = this.versionChecker.getActoriumMcpVersionEntry();
    const npmPackage = entry?.npm_package || DEFAULT_MCP_NPM_PACKAGE;

    const result = await installMcpCli(npmPackage);
    if (result.ok) {
      vscode.window.showInformationMessage(`Actorium: ${result.message}`);
      const workspaceId = this.getWorkspaceId();
      const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
      if (folder) await this.regenerateAgentsFile(folder);
    } else {
      vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    }
    await this._loadMcpCliStatus();
  }

  private currentWorkspaceFolder(): string | undefined {
    const workspaceId = this.getWorkspaceId();
    return workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
  }

  /** Checks how many of the bundled technical skills are already copied
   * into this workspace folder's target-specific skills directory (see
   * technicalSkills.ts) — drives the Skills section's per-agent row. */
  private async _loadTechnicalSkillsStatus(target: AgentTarget): Promise<void> {
    const folder = this.currentWorkspaceFolder();
    const status = folder
      ? await getTechnicalSkillsStatus(this.context, folder, target)
      : { installed: false, total: 0 };
    this._postMessage({ command: 'technicalSkillsStatusLoaded', target, status });
  }

  /** Copies every bundled technical skill into this workspace folder's
   * target-specific skills directory (see technicalSkills.ts) — requires a
   * linked workspace folder since, unlike the actorium-mcp CLI, these
   * skills are written into the workspace itself rather than installed
   * globally. */
  private async _installTechnicalSkills(target: AgentTarget): Promise<void> {
    const folder = this.currentWorkspaceFolder();
    if (!folder) {
      vscode.window.showWarningMessage('Actorium: Link a workspace folder first.');
      this._postMessage({ command: 'technicalSkillsInstallDone', target });
      return;
    }

    const result = await installTechnicalSkills(this.context, folder, target);
    if (result.ok) {
      vscode.window.showInformationMessage(`Actorium: ${result.message}`);
    } else {
      vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    }
    this._postMessage({ command: 'technicalSkillsInstallDone', target });
    await this._loadTechnicalSkillsStatus(target);
  }

  /** Removes every bundled technical skill from this workspace folder's
   * target-specific skills directory (see technicalSkills.ts) — the Skills
   * section's "Uninstall" action once a target is fully installed. */
  private async _uninstallTechnicalSkills(target: AgentTarget): Promise<void> {
    const folder = this.currentWorkspaceFolder();
    if (!folder) {
      vscode.window.showWarningMessage('Actorium: Link a workspace folder first.');
      this._postMessage({ command: 'technicalSkillsInstallDone', target });
      return;
    }

    const result = await uninstallTechnicalSkills(this.context, folder, target);
    if (result.ok) {
      vscode.window.showInformationMessage(`Actorium: ${result.message}`);
    } else {
      vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    }
    this._postMessage({ command: 'technicalSkillsInstallDone', target });
    await this._loadTechnicalSkillsStatus(target);
  }

  /** Re-send extension-owned state on the webview's 'ready' handshake. */
  private _syncState(): void {
    this._postMessage({ command: 'connectionChanged', connected: this._connected });
    this._postMessage({ command: 'workspaceLabelChanged', label: this._workspaceLabel });
    this._postMessage({ command: 'userProfileChanged', profile: this._userProfile });
    if (this._versionBlockedEntry) {
      this._postMessage({ command: 'versionBlocked', entry: this._versionBlockedEntry });
    }
  }

  setConnected(connected: boolean): void {
    this._connected = connected;
    this._postMessage({ command: 'connectionChanged', connected });
  }

  setWorkspaceLabel(label: string | null): void {
    this._workspaceLabel = label;
    this._postMessage({ command: 'workspaceLabelChanged', label });
  }

  /** Update the user profile (name/email/avatar) shown in the navigator
   * header's account menu, or null to clear it on disconnect. */
  setUserProfile(profile: MeUser | null): void {
    this._userProfile = profile;
    this._postMessage({ command: 'userProfileChanged', profile });
  }

  /** Shows a persistent, non-dismissible block overlay when the extension
   * version falls below the backend's minimum supported version. */
  setVersionBlocked(entry: VersionEntry): void {
    this._versionBlockedEntry = entry;
    this._postMessage({ command: 'versionBlocked', entry });
  }

  private _postMessage(message: Record<string, unknown>): void {
    this._view?.webview.postMessage(message);
  }
}
