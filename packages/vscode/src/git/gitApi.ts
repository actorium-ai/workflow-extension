import { execFile as execFileCb } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

import type { API, Commit, GitExtension, Repository } from '../types/git.js';
import { gitErrorMessage, type RepoOpResult } from '../workspace/repoLinker.js';
import { RefType, Status } from './refTypes.js';

const execFile = promisify(execFileCb);

/** git's well-known empty-tree object hash — every git repo has this object
 * implicitly, so diffing a root commit (no parents) against it yields "every
 * file in that commit was added", the same way GitHub/GitLab render a root
 * commit's diff. */
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * The built-in `vscode.git` extension's exported API — event-driven (branch/
 * HEAD/ref state updates push, rather than needing to be polled) and reuses
 * VS Code's own credential handling for pull/fetch against private repos, so
 * this is preferred over shelling out to `git` directly wherever it covers
 * what's needed. `packages/vscode/package.json` declares
 * `extensionDependencies: ["vscode.git"]`, so the Git extension is guaranteed
 * activated before this extension's own activate() runs — getAPI(1) is safe
 * to call synchronously, no activation race to guard against.
 *
 * Returns null if the Git extension is missing or disabled (e.g. a user who
 * explicitly disabled it) — every caller here falls back to a plain
 * `execFile('git', ...)` in that case, same pattern repoLinker.ts already
 * uses for `git clone`.
 */
export function getGitApi(): API | null {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext?.exports?.enabled) return null;
  try {
    return ext.exports.getAPI(1);
  } catch {
    return null;
  }
}

/** Finds the Repository object (if any) the Git extension has already
 * indexed for `folderPath` — matches by resolved fs path rather than by URI
 * string equality, since case/trailing-slash normalization differs across
 * OSes. */
export function findRepository(api: API, folderPath: string): Repository | undefined {
  const normalized = normalizePath(folderPath);
  return api.repositories.find((r) => normalizePath(r.rootUri.fsPath) === normalized);
}

function normalizePath(p: string): string {
  const withoutTrailingSlash = p.replace(/[/\\]+$/, '');
  return process.platform === 'win32' ? withoutTrailingSlash.toLowerCase() : withoutTrailingSlash;
}

/**
 * Pulls whatever branch is currently checked out in `folderPath` — standard
 * `git pull` semantics (fetch + fast-forward/merge the current branch's own
 * upstream), not a fixed "base branch". Prefers the Git extension API's own
 * `repository.pull()` (same credential/auth path as VS Code's own Source
 * Control "Sync" button); falls back to a raw `git pull` CLI call when the
 * Git extension is unavailable or hasn't indexed this folder yet, mirroring
 * repoLinker.ts's existing `git clone` pattern.
 */
export async function pullRepository(folderPath: string): Promise<RepoOpResult> {
  const api = getGitApi();
  const repo = api ? findRepository(api, folderPath) : undefined;

  if (repo) {
    try {
      await repo.pull();
      return { ok: true, message: 'Pulled the latest changes.' };
    } catch (err) {
      return { ok: false, message: `Pull failed: ${gitErrorMessage(err)}` };
    }
  }

  try {
    await execFile('git', ['pull'], { cwd: folderPath });
    return { ok: true, message: 'Pulled the latest changes.' };
  } catch (err) {
    return { ok: false, message: `Pull failed: ${gitErrorMessage(err)}` };
  }
}

/** The name of whichever branch is currently checked out in `folderPath`,
 * or undefined for a detached HEAD / an unreadable repo. Same
 * API-first-then-CLI-fallback strategy as pullRepository above.
 *
 * Calls `repo.status()` before reading `state.HEAD` — the Git extension's
 * cached state only updates on its own FS-watcher debounce, so right after
 * something outside VS Code's UI changes HEAD (our own `execFile('git',
 * ['checkout', ...])` calls included — see handoffCheckout.ts/gitPanel.ts),
 * a caller reading `state.HEAD` immediately afterward can otherwise still see
 * the branch that was checked out *before* that change. */
export async function currentBranch(folderPath: string): Promise<string | undefined> {
  const api = getGitApi();
  const repo = api ? findRepository(api, folderPath) : undefined;
  if (repo) {
    await repo.status();
    return repo.state.HEAD?.name;
  }

  try {
    const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: folderPath,
    });
    const name = stdout.trim();
    return name && name !== 'HEAD' ? name : undefined;
  } catch {
    return undefined;
  }
}

export interface BranchTree {
  /** The currently checked-out branch's name, or undefined for a detached
   * HEAD — mirrors the JetBrains panel's "HEAD (Current Branch)" row. */
  head?: string;
  local: string[];
  remote: string[];
}

/** Splits a Repository's refs into local/remote branch names — tags are
 * deliberately excluded (out of scope for a "which branch am I on" tree;
 * JetBrains' own Log panel keeps tags in a separate list too). */
export function listBranches(repo: Repository): BranchTree {
  const local: string[] = [];
  const remote: string[] = [];
  for (const ref of repo.state.refs) {
    if (!ref.name) continue;
    if (ref.type === RefType.Head) local.push(ref.name);
    else if (ref.type === RefType.RemoteHead) remote.push(ref.name);
  }
  local.sort();
  remote.sort();
  return { head: repo.state.HEAD?.name, local, remote };
}

/**
 * Same as listBranches, but resolves the Repository from a folder path
 * itself and falls back to plain `git branch -a` when the Git extension
 * hasn't indexed that folder — VS Code's built-in auto-detection doesn't
 * reliably pick up every repo in a workspace with many nested/symlinked
 * repos (this extension's whole multi-repo-folder model), so relying on
 * the API alone silently breaks branch listing/switching for whichever
 * repos it missed. `--format=%(refname)` gives the full ref path
 * (refs/heads/... vs refs/remotes/...), which is what actually
 * distinguishes local from remote — a plain `git branch -a` listing can't
 * be told apart by name alone.
 */
export async function listBranchesForPath(folderPath: string): Promise<BranchTree> {
  const api = getGitApi();
  const repo = api ? findRepository(api, folderPath) : undefined;
  if (repo) return listBranches(repo);

  try {
    const [{ stdout }, head] = await Promise.all([
      execFile('git', ['branch', '-a', '--format=%(refname)'], { cwd: folderPath }),
      currentBranch(folderPath),
    ]);
    const local: string[] = [];
    const remote: string[] = [];
    for (const raw of stdout.split('\n')) {
      const ref = raw.trim();
      if (ref.startsWith('refs/heads/')) {
        local.push(ref.slice('refs/heads/'.length));
      } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
        remote.push(ref.slice('refs/remotes/'.length));
      }
    }
    local.sort();
    remote.sort();
    return { head, local, remote };
  } catch {
    return { local: [], remote: [] };
  }
}

/** Strips a remote branch's "origin/" prefix, e.g. "origin/feature-x" →
 * "feature-x". Checking out a bare remote-tracking ref by ITS full name
 * (`git checkout origin/feature-x`) leaves a detached HEAD; checking out
 * the short name instead (`git checkout feature-x`) is what makes git
 * create a local tracking branch for it, matching what VS Code's own
 * branch picker does when you pick a remote branch. */
export function shortBranchName(remoteBranch: string): string {
  const idx = remoteBranch.indexOf('/');
  return idx === -1 ? remoteBranch : remoteBranch.slice(idx + 1);
}

export interface CommitEntry {
  hash: string;
  message: string;
  authorName?: string;
  /** ISO 8601 — Date objects don't survive webview postMessage/JSON
   * round-trips, so every caller across the postMessage boundary gets a
   * plain string and re-parses it only if it needs to (e.g. for display
   * formatting), same convention as every other date field in this
   * extension's webview protocol. */
  authorDate?: string;
}

/** Fetches up to `maxEntries` commits reachable from `ref` (defaults to
 * HEAD when omitted, matching `repository.log`'s own default) — serialized
 * to plain strings, see CommitEntry's doc comment. */
export async function getCommitLog(
  repo: Repository,
  ref: string | undefined,
  maxEntries: number,
): Promise<CommitEntry[]> {
  const commits = await repo.log({ ref, maxEntries });
  return commits.map(toCommitEntry);
}

function toCommitEntry(commit: Commit): CommitEntry {
  return {
    hash: commit.hash,
    message: commit.message,
    authorName: commit.authorName,
    authorDate: commit.authorDate?.toISOString(),
  };
}

/** Unit separator (0x1f) as the field delimiter for `git log --format` below
 * — a character that can never appear in a commit message/author name, so
 * it splits cleanly even when those contain other punctuation. */
const LOG_FIELD_SEP = '\x1f';

/** Same as getCommitLog, but resolves the Repository from a folder path and
 * falls back to `git log` when the Git extension hasn't indexed it — see
 * listBranchesForPath's doc comment for why that fallback is needed at all
 * in this extension's multi-repo-folder workspaces. */
export async function getCommitLogForPath(
  folderPath: string,
  ref: string | undefined,
  maxEntries: number,
): Promise<CommitEntry[]> {
  const api = getGitApi();
  const repo = api ? findRepository(api, folderPath) : undefined;
  if (repo) return getCommitLog(repo, ref, maxEntries);

  try {
    const args = [
      'log',
      `--format=%H${LOG_FIELD_SEP}%s${LOG_FIELD_SEP}%an${LOG_FIELD_SEP}%aI`,
      '-n',
      String(maxEntries),
    ];
    if (ref) args.push(ref);
    const { stdout } = await execFile('git', args, { cwd: folderPath });
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, message, authorName, authorDate] = line.split(LOG_FIELD_SEP);
        return { hash: hash ?? '', message: message ?? '', authorName, authorDate };
      });
  } catch {
    return [];
  }
}

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'other';

function toChangeStatus(status: Status): ChangeStatus {
  switch (status) {
    case Status.INDEX_ADDED:
    case Status.INTENT_TO_ADD:
    case Status.UNTRACKED:
      return 'added';
    case Status.INDEX_DELETED:
    case Status.DELETED:
      return 'deleted';
    case Status.INDEX_RENAMED:
    case Status.INTENT_TO_RENAME:
      return 'renamed';
    case Status.MODIFIED:
    case Status.INDEX_MODIFIED:
    case Status.INDEX_COPIED:
    case Status.TYPE_CHANGED:
      return 'modified';
    default:
      return 'other';
  }
}

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
}

/** The files a commit touched, with per-file status — diffs the commit
 * against its first parent (or git's well-known empty-tree object for a
 * root commit with no parents), matching how GitHub/GitLab render a single
 * commit's changes. No line-count stats: the extension API's `Change` type
 * doesn't carry them, and shelling out to `git show --numstat` just for
 * this is an acceptable v1 gap (file list + status only, same level of
 * detail VS Code's own Timeline view shows). */
export async function getChangedFiles(
  repo: Repository,
  commitHash: string,
): Promise<ChangedFile[]> {
  const commit = await repo.getCommit(commitHash);
  const parent = commit.parents[0] ?? EMPTY_TREE_HASH;
  const changes = await repo.diffBetween(parent, commitHash);
  return changes.map((c) => ({
    path: path.relative(repo.rootUri.fsPath, c.uri.fsPath).split(path.sep).join('/'),
    status: toChangeStatus(c.status),
  }));
}

function cliStatusCodeToChangeStatus(code: string): ChangeStatus {
  const c = code[0];
  if (c === 'A') return 'added';
  if (c === 'D') return 'deleted';
  if (c === 'R') return 'renamed';
  if (c === 'M') return 'modified';
  return 'other';
}

/** Same as getChangedFiles, but resolves the Repository from a folder path
 * and falls back to `git show --name-status` when the Git extension hasn't
 * indexed it — see listBranchesForPath's doc comment for why. `--format=`
 * (empty) suppresses the commit header, leaving just the name-status lines;
 * a rename line is `R100\told/path\tnew/path` — the LAST tab-separated
 * field is always the current path, which is what's wanted here. */
export async function getChangedFilesForPath(
  folderPath: string,
  commitHash: string,
): Promise<ChangedFile[]> {
  const api = getGitApi();
  const repo = api ? findRepository(api, folderPath) : undefined;
  if (repo) return getChangedFiles(repo, commitHash);

  try {
    const { stdout } = await execFile('git', ['show', '--name-status', '--format=', commitHash], {
      cwd: folderPath,
    });
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        const code = parts[0] ?? '';
        const filePath = parts[parts.length - 1] ?? '';
        return { path: filePath, status: cliStatusCodeToChangeStatus(code) };
      });
  } catch {
    return [];
  }
}

/** Checks out a branch by name in `folderPath` — API-first, CLI fallback,
 * same strategy as pullRepository/currentBranch above. */
export async function checkoutBranch(
  folderPath: string,
  branchName: string,
): Promise<RepoOpResult> {
  const api = getGitApi();
  const repo = api ? findRepository(api, folderPath) : undefined;

  if (repo) {
    try {
      await repo.checkout(branchName);
      return { ok: true, message: `Checked out "${branchName}".` };
    } catch (err) {
      return { ok: false, message: `Checkout failed: ${gitErrorMessage(err)}` };
    }
  }

  try {
    await execFile('git', ['checkout', branchName], { cwd: folderPath });
    return { ok: true, message: `Checked out "${branchName}".` };
  } catch (err) {
    return { ok: false, message: `Checkout failed: ${gitErrorMessage(err)}` };
  }
}
