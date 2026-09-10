import * as vscode from 'vscode';

import { buildWebviewHtml } from '../webview-html.js';
import { getWorkspaceFolder } from '../workspace/folderManager.js';
import { listLinkedRepos } from '../workspace/repoLinker.js';
import { readRepoLinkManifest } from '../workspace/repoLinkManifest.js';
import {
  checkoutBranch,
  findRepository,
  getChangedFilesForPath,
  getCommitLogForPath,
  getGitApi,
  listBranchesForPath,
  pullRepository,
} from './gitApi.js';

const DEFAULT_LOG_ENTRIES = 100;

/**
 * JetBrains-style Git tool window: a bottom-panel view (contributes.views'
 * "actorium-git" container, alongside where a terminal/console tab would
 * sit) showing one repo's branch tree + commit log at a time, with a picker
 * across every repo the current workspace has linked (see
 * repoLinker.ts/repoLinkManifest.ts — the same set the sidebar's Workspace
 * section shows). Deliberately single-repo, not a unified multi-repo log —
 * see the design plan for why.
 */
export class GitPanelProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;
  private _selectedRepoPath: string | null = null;
  private _logMaxEntries = DEFAULT_LOG_ENTRIES;
  private _stateSubscription: vscode.Disposable | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getWorkspaceId: () => string | null,
    private readonly getBffUrl: () => string,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist')],
    };
    webviewView.webview.html = buildWebviewHtml(this.context, webviewView.webview, {
      panelKind: 'git',
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'ready':
        case 'listGitRepos':
          await this._loadRepos();
          break;
        case 'selectGitRepo':
          await this._selectRepo(message.path);
          break;
        case 'listGitCommits':
          this._logMaxEntries = DEFAULT_LOG_ENTRIES;
          await this._loadCommits(message.ref);
          break;
        case 'loadMoreGitCommits':
          this._logMaxEntries += DEFAULT_LOG_ENTRIES;
          await this._loadCommits(message.ref);
          break;
        case 'getGitCommitDetails':
          await this._loadCommitDetails(message.hash);
          break;
        case 'gitPull':
          await this._pull();
          break;
        case 'gitCheckout':
          await this._checkout(message.branch);
          break;
        case 'showBranchContextMenu':
          await this._showBranchContextMenu(message.branch);
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this._stateSubscription?.dispose();
      this._stateSubscription = null;
      this._view = null;
    });
  }

  private _folder(): string | undefined {
    const workspaceId = this.getWorkspaceId();
    return workspaceId
      ? getWorkspaceFolder(this.context, this.getBffUrl(), workspaceId)
      : undefined;
  }

  private async _loadRepos(): Promise<void> {
    const folder = this._folder();
    if (!folder) {
      this._postMessage({ command: 'gitReposLoaded', repos: [] });
      return;
    }
    const [linked, manifest] = await Promise.all([
      listLinkedRepos(folder),
      readRepoLinkManifest(folder),
    ]);
    const repos = linked
      .filter((r) => r.target && !r.broken)
      .map((r) => ({ name: manifest[r.name] ?? r.name, path: r.target as string }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this._postMessage({ command: 'gitReposLoaded', repos });

    // Auto-select something on first load (or if the previously-selected
    // repo got unlinked) so the panel isn't a blank picker with nothing to
    // look at — the JetBrains window it mirrors always has a repo active.
    const firstRepo = repos[0];
    if (firstRepo && !repos.some((r) => r.path === this._selectedRepoPath)) {
      await this._selectRepo(firstRepo.path);
    }
  }

  private async _selectRepo(repoPath: string): Promise<void> {
    this._selectedRepoPath = repoPath;
    this._logMaxEntries = DEFAULT_LOG_ENTRIES;
    this._subscribeToRepoState(repoPath);
    await this._loadBranches();
    await this._loadCommits(undefined);
  }

  /** Reacts to the Git extension's own change events (new commit, branch
   * switch, fetch...) for the selected repo, so the panel updates itself
   * without the user needing to hit refresh — mirrors how VS Code's own
   * Source Control view stays live. */
  private _subscribeToRepoState(repoPath: string): void {
    this._stateSubscription?.dispose();
    this._stateSubscription = null;
    const api = getGitApi();
    const repo = api ? findRepository(api, repoPath) : undefined;
    if (!repo) return;
    this._stateSubscription = repo.state.onDidChange(() => {
      void this._loadBranches();
    });
  }

  private async _loadBranches(): Promise<void> {
    if (!this._selectedRepoPath) {
      this._postMessage({ command: 'gitBranchesLoaded', head: undefined, local: [], remote: [] });
      return;
    }
    const branches = await listBranchesForPath(this._selectedRepoPath);
    this._postMessage({ command: 'gitBranchesLoaded', ...branches });
  }

  private async _loadCommits(ref: string | undefined): Promise<void> {
    if (!this._selectedRepoPath) {
      this._postMessage({ command: 'gitCommitsLoaded', commits: [] });
      return;
    }
    try {
      const commits = await getCommitLogForPath(this._selectedRepoPath, ref, this._logMaxEntries);
      this._postMessage({ command: 'gitCommitsLoaded', commits });
    } catch (err) {
      this._postMessage({
        command: 'gitError',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async _loadCommitDetails(hash: string): Promise<void> {
    if (!this._selectedRepoPath) return;
    try {
      const files = await getChangedFilesForPath(this._selectedRepoPath, hash);
      this._postMessage({ command: 'gitCommitDetailsLoaded', hash, files });
    } catch (err) {
      this._postMessage({
        command: 'gitError',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async _pull(): Promise<void> {
    if (!this._selectedRepoPath) return;
    const result = await pullRepository(this._selectedRepoPath);
    if (!result.ok) vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    this._postMessage({ command: 'gitActionDone', ok: result.ok, message: result.message });
    await this._loadBranches();
    await this._loadCommits(undefined);
  }

  private async _checkout(branch: string): Promise<void> {
    if (!this._selectedRepoPath) return;
    const result = await checkoutBranch(this._selectedRepoPath, branch);
    if (!result.ok) vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    this._postMessage({ command: 'gitActionDone', ok: result.ok, message: result.message });
    await this._loadBranches();
    await this._loadCommits(undefined);
  }

  /** Native QuickPick on right-click — same idiom as handoffCheckout.ts's
   * showFeatureContextMenu, rather than a custom webview dropdown. */
  private async _showBranchContextMenu(branch: string): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      [{ label: 'Checkout', id: 'checkout' as const }],
      { placeHolder: branch },
    );
    if (picked?.id === 'checkout') await this._checkout(branch);
  }

  private _postMessage(message: Record<string, unknown>): void {
    if (this._view) void this._view.webview.postMessage(message);
  }
}
