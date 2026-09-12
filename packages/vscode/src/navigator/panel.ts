import type { AccountSummary, MeUser, VersionEntry } from '@workflow-extension/shared';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  checkoutBranch,
  currentBranch,
  listBranchesForPath,
  pullRepository,
  shortBranchName,
} from '../git/gitApi.js';
import { compareVersions, type VersionChecker } from '../version/checker.js';
import { buildWebviewHtml } from '../webview-html.js';
import { getWorkspaceFolder, removeWorkspaceFolder } from '../workspace/folderManager.js';
import { checkoutHandoffPRs } from '../workspace/handoffCheckout.js';
import {
  type AgentStatus,
  type AgentTarget,
  DEFAULT_MCP_NPM_PACKAGE,
  getClaudeCodeStatus,
  getCodexStatus,
  getMcpCliStatus,
  getOpencodeStatus,
  installMcpCli,
} from '../workspace/mcpConnect.js';
import { getAgentSessionOpenedAt, getMcpRegistration } from '../workspace/mcpRegistrationState.js';
import {
  cloneAllRepos,
  cloneRepo,
  listLinkedRepos,
  removeBrokenLink,
  resolveLinkedRepoPath,
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
  private _accounts: AccountSummary[] = [];
  private _sessionExpired = false;
  private _versionBlockedEntry: VersionEntry | null = null;
  private _pollInterval: NodeJS.Timeout | null = null;
  private _mcpConfigUpdatedAt: number | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly codingApiCtx: CodingApiContext,
    private readonly docContentProvider: DocContentProvider,
    private readonly getWorkspaceId: () => string | null,
    private readonly versionChecker: VersionChecker,
    private readonly regenerateAgentsFile: (folderPath: string) => Promise<void>,
    private readonly getFrontendUrl: () => string | null,
    private readonly checkSessionExpiry: () => void,
    private readonly getEnvironmentLabel: () => string,
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
      // Piggybacks on this existing tick rather than a dedicated timer — see
      // AuthManager.checkExpiry()'s doc comment for why this matters (no
      // token-refresh flow exists, so this is how a mid-session expiry gets
      // caught instead of only at the next failed request).
      if (this._connected) this.checkSessionExpiry();
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

        case 'switchAccount':
          vscode.commands.executeCommand('actorium.switchAccount', message.accountId);
          break;

        case 'addAccount':
          vscode.commands.executeCommand('actorium.addAccount');
          break;

        case 'reconnectAccount':
          vscode.commands.executeCommand('actorium.reconnectAccount');
          break;

        case 'reload':
          vscode.commands.executeCommand('workbench.action.reloadWindow');
          break;

        case 'openProfileSettings': {
          const frontendUrl = this.getFrontendUrl();
          if (frontendUrl)
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

        case 'checkoutHandoffPRs':
          await checkoutHandoffPRs(this.context, this.codingApiCtx, message.feature);
          this._postMessage({ command: 'checkoutHandoffPRsDone', featureId: message.feature.id });
          // Checkout may have switched branches in one or more repos — refresh
          // the Workspace section's branch badges rather than leaving them
          // showing whatever was checked out before.
          await this._loadRepos();
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

        case 'pullRepo':
          await this._pullRepo(message.name);
          break;

        case 'pullAllRepos':
          await this._pullAllRepos();
          break;

        case 'checkoutDefaultBranches':
          await this._checkoutDefaultBranches();
          break;

        case 'switchRepoBranch':
          await this._switchRepoBranch(message.name);
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

        case 'unlinkWorkspaceFolder':
          await this._unlinkWorkspaceFolder();
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
    if (!workspaceId) {
      this._postMessage({ command: 'docsLoaded', docs: [] });
      return;
    }
    const result = await listDocuments(codingApiConfig(this.codingApiCtx), workspaceId);
    this._postMessage(
      result.ok
        ? { command: 'docsLoaded', docs: result.data }
        : { command: 'docsLoaded', docs: [], error: result.reason },
    );
  }

  private async _loadFeatures(): Promise<void> {
    const workspaceId = this.codingApiCtx.getWorkspaceId();
    if (!workspaceId) {
      this._postMessage({ command: 'featuresLoaded', features: [] });
      return;
    }
    const result = await listFeatures(codingApiConfig(this.codingApiCtx), workspaceId);
    this._postMessage(
      result.ok
        ? { command: 'featuresLoaded', features: result.data }
        : { command: 'featuresLoaded', features: [], error: result.reason },
    );
  }

  private async _loadRepos(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
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
      currentBranch?: string;
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

    // Resolved after the merge above (not inline in the loops) so both the
    // workspace-known and locally-only branches of repos get it uniformly,
    // and only once per repo. Skipped for anything with no usable local
    // path (not linked, or a broken symlink) — nothing to ask git about.
    await Promise.all(
      repos.map(async (r) => {
        if (r.target && !r.broken) {
          r.currentBranch = await currentBranch(r.target);
        }
      }),
    );

    this._postMessage({ command: 'reposLoaded', repos, hasWorkspaceFolder: !!folder });
  }

  /** Confirms (destructive-adjacent — removes a symlink, though the real
   * clone it points to is untouched) then removes a repo's symlink from the
   * workspace folder. Refreshes AGENTS.md/manifest and the repo list on
   * success, same as every other repo-state-changing op. */
  private async _unlinkRepo(name: string): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
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

  /** Pulls whatever branch is currently checked out for one linked repo —
   * `name` is the LOCAL folder name (repo.linkName ?? repo.name from the
   * webview, same convention as _unlinkRepo above), joined against the
   * workspace folder directly since a repo row here is by definition already
   * linked (symlink or real clone) at that path. */
  private async _pullRepo(name: string): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
    if (!folder) return;

    const repoPath = path.join(folder, name);
    const result = await pullRepository(repoPath);
    if (!result.ok) {
      vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    }
    this._postMessage({ command: 'pullRepoDone', name });
    await this._loadRepos();
  }

  /** Pulls every linked repo's current branch, in parallel — skips a repo
   * with no usable local path (not linked, or a broken symlink) rather than
   * erroring the whole batch on one bad repo. */
  private async _pullAllRepos(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
    if (!folder) {
      this._postMessage({ command: 'pullAllReposDone' });
      return;
    }

    const linked = (await listLinkedRepos(folder)).filter((r) => r.target && !r.broken);
    if (linked.length === 0) {
      vscode.window.showInformationMessage('Actorium: No linked repos to pull.');
      this._postMessage({ command: 'pullAllReposDone' });
      return;
    }

    const results = await Promise.all(
      linked.map(async (r) => ({ name: r.name, result: await pullRepository(r.target as string) })),
    );
    const failed = results.filter((r) => !r.result.ok);

    if (failed.length === 0) {
      vscode.window.showInformationMessage(`Actorium: Pulled ${results.length} repos.`);
    } else {
      vscode.window.showWarningMessage(
        `Actorium: Pulled ${results.length - failed.length} of ${results.length} repos. Failed: ${failed
          .map((f) => `${f.name} (${f.result.message})`)
          .join('; ')}`,
      );
    }
    this._postMessage({ command: 'pullAllReposDone' });
    await this._loadRepos();
  }

  /** Checks out every linked repo's own base branch (workflow-backend's
   * `WorkspaceRepo.base_branch` — the SAME "Base branch" column the web
   * app's Repositories settings page shows), the counterpart to "Checkout
   * PR for review": one action to put every repo back on its default branch
   * after reviewing a handoff. Confirms once, naming every repo/branch,
   * before touching anything — same reasoning as checkoutHandoffPRs. Repos
   * with no known base branch, or no usable local path, are skipped rather
   * than erroring the whole batch. */
  private async _checkoutDefaultBranches(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
    if (!folder || !workspaceId) {
      this._postMessage({ command: 'checkoutDefaultBranchesDone' });
      return;
    }

    const [linked, workspaceRepos, repoLinkManifest] = await Promise.all([
      listLinkedRepos(folder),
      getWorkspaceRepos(codingApiConfig(this.codingApiCtx), workspaceId),
      readRepoLinkManifest(folder),
    ]);

    const targets: { name: string; branch: string; repoPath: string }[] = [];
    for (const wr of workspaceRepos ?? []) {
      if (!wr.base_branch) continue;
      const repoPath = resolveLinkedRepoPath(linked, repoLinkManifest, wr.repo_id);
      if (repoPath) targets.push({ name: wr.repo_id, branch: wr.base_branch, repoPath });
    }

    if (targets.length === 0) {
      vscode.window.showInformationMessage(
        'Actorium: No linked repos with a known base branch to check out.',
      );
      this._postMessage({ command: 'checkoutDefaultBranchesDone' });
      return;
    }

    const summaryList = targets.map((t) => `${t.name} (${t.branch})`).join(', ');
    const confirmed = await vscode.window.showWarningMessage(
      `Checkout the base branch in ${targets.length === 1 ? '1 repo' : `${targets.length} repos`}? ${summaryList}.`,
      { modal: true },
      'Checkout',
    );
    if (confirmed !== 'Checkout') {
      this._postMessage({ command: 'checkoutDefaultBranchesDone' });
      return;
    }

    const results = await Promise.all(
      targets.map(async (t) => ({
        name: t.name,
        branch: t.branch,
        result: await checkoutBranch(t.repoPath, t.branch),
      })),
    );
    const failed = results.filter((r) => !r.result.ok);

    if (failed.length === 0) {
      vscode.window.showInformationMessage(
        `Actorium: Checked out the base branch in ${results.length} repos.`,
      );
    } else {
      vscode.window.showWarningMessage(
        `Actorium: Checked out ${results.length - failed.length} of ${results.length}. Failed: ${failed
          .map((f) => `${f.name} (${f.branch} — ${f.result.message})`)
          .join('; ')}`,
      );
    }
    this._postMessage({ command: 'checkoutDefaultBranchesDone' });
    await this._loadRepos();
  }

  /** Shows a searchable QuickPick of every local/remote branch for one
   * linked repo and checks out whichever one is picked — a QuickPick is the
   * right fit here (VS Code's own branch switcher works the same way)
   * unlike the feature row's small fixed action list (see
   * feature-list.tsx's in-webview ContextMenu for that one instead). A
   * remote branch is checked out by its short name (stripping the
   * "origin/" prefix) so git creates a local tracking branch instead of a
   * detached HEAD, matching `git checkout <shortname>`'s own default
   * behavior. */
  private async _switchRepoBranch(name: string): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
    if (!folder) return;

    const repoPath = path.join(folder, name);
    const { head, local, remote } = await listBranchesForPath(repoPath);
    if (local.length === 0 && remote.length === 0) {
      vscode.window.showWarningMessage(`Actorium: Couldn't read branches for "${name}".`);
      return;
    }

    const items: vscode.QuickPickItem[] = [
      ...local.map((branch) => ({
        label: branch,
        description: branch === head ? 'current' : undefined,
      })),
      ...remote.map((branch) => ({ label: branch, description: 'remote' })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Switch branch for "${name}"`,
    });
    if (!picked || picked.label === head) return;

    const target = picked.description === 'remote' ? shortBranchName(picked.label) : picked.label;
    const result = await checkoutBranch(repoPath, target);
    if (!result.ok) vscode.window.showErrorMessage(`Actorium: ${result.message}`);
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
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
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
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
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
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
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

  /** Confirms (nothing on disk is touched — the folder and every repo
   * symlinked into it are left alone) then drops the extension's record of
   * which local folder this workspace is linked to — the section menu's
   * "Unlink workspace" action. Refreshes the repo list afterward so the
   * panel falls back to its "link a folder" empty state, same as
   * _unlinkRepo does for a single repo. */
  private async _unlinkWorkspaceFolder(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
    if (!workspaceId || !folder) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Unlink the local folder "${folder}" from this workspace? Nothing on disk will be deleted — you can re-link the same or a different folder later.`,
      { modal: true },
      'Unlink',
    );
    if (confirmed !== 'Unlink') return;

    await removeWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId);
    await this._loadRepos();
  }

  /** Passive status check — never prompts to link a workspace folder (unlike
   * the connect/disconnect commands), since this fires automatically on
   * every panel load/refresh and shouldn't surprise the user with a QuickPick
   * just for opening the sidebar. */
  private async _loadMcpStatus(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
    if (!folder) {
      this._postMessage({ command: 'mcpStatusLoaded', statuses: {} });
      return;
    }
    const [claude, codex, opencode] = await Promise.all([
      getClaudeCodeStatus(folder),
      getCodexStatus(folder),
      getOpencodeStatus(folder),
    ]);
    const raw: Record<AgentTarget, AgentStatus> = { claude, codex, opencode };

    const activeAccount = this._accounts.find((a) => a.isActive);
    const activeAccountLabel = activeAccount
      ? activeAccount.user.display_name || activeAccount.user.email
      : null;

    const statuses: Record<AgentTarget, AgentStatus> = { claude, codex, opencode };
    for (const target of Object.keys(raw) as AgentTarget[]) {
      const status = raw[target];
      if (!status.registered) continue;
      const rec = getMcpRegistration(this.context, folder, target);
      const sessionOpenedAt = getAgentSessionOpenedAt(this.context, folder, target);
      statuses[target] = {
        ...status,
        boundAccountLabel: rec?.accountLabel,
        boundWorkspaceLabel: rec?.workspaceLabel,
        stale:
          !!rec &&
          ((rec.accountLabel ?? null) !== activeAccountLabel ||
            (rec.workspaceLabel ?? null) !== this._workspaceLabel),
        needsRestart:
          sessionOpenedAt !== undefined &&
          this._mcpConfigUpdatedAt !== null &&
          sessionOpenedAt < this._mcpConfigUpdatedAt,
      };
    }
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
      const folder = workspaceId
        ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
        : undefined;
      if (folder) await this.regenerateAgentsFile(folder);
    } else {
      vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    }
    await this._loadMcpCliStatus();
  }

  private currentWorkspaceFolder(): string | undefined {
    const workspaceId = this.getWorkspaceId();
    return workspaceId
      ? getWorkspaceFolder(this.context, this.codingApiCtx.getBffUrl(), workspaceId)
      : undefined;
  }

  /** Checks how many of this workspace's registry-resolved skills are
   * already synced into this workspace folder's target-specific skills
   * directory (see technicalSkills.ts) — drives the Skills section's
   * per-agent row. */
  private async _loadTechnicalSkillsStatus(target: AgentTarget): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = this.currentWorkspaceFolder();
    const status =
      workspaceId && folder
        ? await getTechnicalSkillsStatus(
            codingApiConfig(this.codingApiCtx),
            workspaceId,
            folder,
            target,
          )
        : { installed: false, total: 0 };
    this._postMessage({ command: 'technicalSkillsStatusLoaded', target, status });
  }

  /** Fetches every skill this workspace resolves from workflow-backend's
   * skills registry and writes them into this workspace folder's
   * target-specific skills directory (see technicalSkills.ts) — requires a
   * linked workspace folder since, unlike the actorium-mcp CLI, these
   * skills are written into the workspace itself rather than installed
   * globally. */
  private async _installTechnicalSkills(target: AgentTarget): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = this.currentWorkspaceFolder();
    if (!workspaceId || !folder) {
      vscode.window.showWarningMessage('Actorium: Link a workspace folder first.');
      this._postMessage({ command: 'technicalSkillsInstallDone', target });
      return;
    }

    const result = await installTechnicalSkills(
      codingApiConfig(this.codingApiCtx),
      workspaceId,
      folder,
      target,
    );
    if (result.ok) {
      vscode.window.showInformationMessage(`Actorium: ${result.message}`);
    } else {
      vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    }
    this._postMessage({ command: 'technicalSkillsInstallDone', target });
    await this._loadTechnicalSkillsStatus(target);
  }

  /** Removes every synced technical skill from this workspace folder's
   * target-specific skills directory (see technicalSkills.ts) — the Skills
   * section's "Uninstall" action once a target is fully installed. */
  private async _uninstallTechnicalSkills(target: AgentTarget): Promise<void> {
    const folder = this.currentWorkspaceFolder();
    if (!folder) {
      vscode.window.showWarningMessage('Actorium: Link a workspace folder first.');
      this._postMessage({ command: 'technicalSkillsInstallDone', target });
      return;
    }

    const result = await uninstallTechnicalSkills(folder, target);
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
    this._postMessage({
      command: 'connectionChanged',
      connected: this._connected,
      environmentLabel: this.getEnvironmentLabel(),
    });
    this._postMessage({ command: 'workspaceLabelChanged', label: this._workspaceLabel });
    this._postMessage({ command: 'userProfileChanged', profile: this._userProfile });
    this._postMessage({ command: 'accountsChanged', accounts: this._accounts });
    this._postMessage({ command: 'sessionExpiredChanged', expired: this._sessionExpired });
    if (this._versionBlockedEntry) {
      this._postMessage({ command: 'versionBlocked', entry: this._versionBlockedEntry });
    }
  }

  setConnected(connected: boolean): void {
    this._connected = connected;
    this._postMessage({
      command: 'connectionChanged',
      connected,
      environmentLabel: this.getEnvironmentLabel(),
    });
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

  /** Update the account switcher's list — every account this machine has
   * stored credentials for, with which one is currently active. Refreshed
   * alongside every connection/profile/workspace change (see extension.ts),
   * since the account list effectively changes exactly when those do. */
  setAccounts(accounts: AccountSummary[]): void {
    this._accounts = accounts;
    this._postMessage({ command: 'accountsChanged', accounts });
  }

  /** Mirrors AuthManager.isSessionExpired() into the webview — pushed
   * alongside every connection/profile/workspace/account change (see
   * extension.ts) rather than solely from the one-shot onSessionExpired
   * callback, so the banner always reflects the CURRENT value regardless of
   * which event last fired (a switch/reconnect that immediately re-expires,
   * or one that recovers, both need this to read the authoritative value
   * rather than assume true/false from context). */
  setSessionExpired(expired: boolean): void {
    this._sessionExpired = expired;
    this._postMessage({ command: 'sessionExpiredChanged', expired });
  }

  /** Called after reconcileMcpForCurrentAccount rewrites one or more agents'
   * on-disk MCP config (see extension.ts) — reloads MCP status immediately
   * (rather than waiting for the webview to notice and ask) so the
   * stale/needsRestart badges in agent-status-list.tsx update right away. */
  setMcpConfigUpdatedAt(timestamp: number): void {
    this._mcpConfigUpdatedAt = timestamp;
    void this._loadMcpStatus();
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
