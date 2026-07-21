import * as vscode from 'vscode';
import type { ToolResultPayload } from '@workflow-extension/shared';

interface GitRepository {
  state: {
    HEAD?: { name?: string };
    workingTreeChanges: Array<{ uri: { fsPath: string }; status: number }>;
    indexChanges: Array<{ uri: { fsPath: string } }>;
    remotes: Array<{ fetchUrl?: string; pushUrl?: string }>;
  };
  diffIndexWithHEAD(): Promise<string>;
  commit(message: string): Promise<void>;
  push(remote?: string, branch?: string, setUpstream?: boolean): Promise<void>;
  checkout(treeish: string): Promise<void>;
  log(options?: { maxEntries?: number }): Promise<Array<{ hash: string; message: string }>>;
}

/**
 * Execute git operations using the VS Code Git extension API.
 *
 * All operations use the developer's local git state and SSH keys.
 * The agent never touches the filesystem for git — it delegates to the extension.
 */
export class GitOps {
  /**
   * Get the git repository for the workspace.
   */
  private _getRepo(): GitRepository | null {
    try {
      const gitExt = vscode.extensions.getExtension('vscode.git');
      if (!gitExt || !gitExt.isActive) {
        return null;
      }
      const gitApi = gitExt.exports.getAPI(1);
      return gitApi.repositories[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get the current git status.
   */
  async gitStatus(): Promise<ToolResultPayload> {
    const repo = this._getRepo();
    if (!repo) {
      return { ok: false, error: 'No git repository found' };
    }

    const state = repo.state;
    const branch = state.HEAD?.name ?? 'detached';
    const modified = state.workingTreeChanges.map((c) => c.uri.fsPath);
    const staged = state.indexChanges.map((c) => c.uri.fsPath);
    const untracked = state.workingTreeChanges
      .filter((c) => c.status === 128)
      .map((c) => c.uri.fsPath);
    const remote = state.remotes[0]?.fetchUrl ?? 'none';

    const summary = [
      `Branch: ${branch}`,
      `Remote: ${remote}`,
      '',
      `Modified (${modified.length}):`,
      ...modified.map((f) => `  M ${f}`),
      '',
      `Staged (${staged.length}):`,
      ...staged.map((f) => `  A ${f}`),
      '',
      `Untracked (${untracked.length}):`,
      ...untracked.map((f) => `  ? ${f}`),
    ].join('\n');

    return { ok: true, content: summary };
  }

  /**
   * Get the working tree diff.
   */
  async gitDiff(): Promise<ToolResultPayload> {
    const repo = this._getRepo();
    if (!repo) {
      return { ok: false, error: 'No git repository found' };
    }

    try {
      const diff = await repo.diffIndexWithHEAD();
      return { ok: true, content: diff || '(no changes)' };
    } catch (err) {
      return { ok: false, error: `Git diff failed: ${err}` };
    }
  }

  /**
   * Commit staged changes with a message.
   */
  async gitCommit(message: string): Promise<ToolResultPayload> {
    const repo = this._getRepo();
    if (!repo) {
      return { ok: false, error: 'No git repository found' };
    }

    try {
      await repo.commit(message);
      return { ok: true, content: `Committed: ${message}` };
    } catch (err) {
      return { ok: false, error: `Git commit failed: ${err}` };
    }
  }

  /**
   * Push commits to the remote.
   */
  async gitPush(branch?: string): Promise<ToolResultPayload> {
    const repo = this._getRepo();
    if (!repo) {
      return { ok: false, error: 'No git repository found' };
    }

    try {
      await repo.push('origin', branch ?? repo.state.HEAD?.name ?? 'main', false);
      return { ok: true, content: 'Push successful' };
    } catch (err) {
      return { ok: false, error: `Git push failed: ${err}` };
    }
  }

  /**
   * Checkout a branch or commit.
   */
  async gitCheckout(ref: string): Promise<ToolResultPayload> {
    const repo = this._getRepo();
    if (!repo) {
      return { ok: false, error: 'No git repository found' };
    }

    try {
      await repo.checkout(ref);
      return { ok: true, content: `Checked out: ${ref}` };
    } catch (err) {
      return { ok: false, error: `Git checkout failed: ${err}` };
    }
  }

  /**
   * Show git log.
   */
  async gitLog(maxEntries: number = 20): Promise<ToolResultPayload> {
    const repo = this._getRepo();
    if (!repo) {
      return { ok: false, error: 'No git repository found' };
    }

    try {
      const entries = await repo.log({ maxEntries });
      const output = entries.map((e) => `${e.hash.substring(0, 8)} ${e.message}`).join('\n');
      return { ok: true, content: output || '(no commits)' };
    } catch (err) {
      return { ok: false, error: `Git log failed: ${err}` };
    }
  }
}
