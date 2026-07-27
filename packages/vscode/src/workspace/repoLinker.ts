import { execFile as execFileCb } from 'child_process';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

import { removeRepoLink, setRepoLink } from './repoLinkManifest.js';

const execFile = promisify(execFileCb);

export interface LinkedRepo {
  name: string;
  /** Absent only for a broken symlink (its target no longer exists). */
  target?: string;
  /** False for a repo cloned directly into the workspace folder (the
   * default for new clones — see cloneRepo). True for a repo linked in from
   * elsewhere on disk via addRepo, or an older clone made before that was
   * the default. */
  isSymlink: boolean;
  /** True only when isSymlink is true and its target has been deleted. */
  broken?: boolean;
}

export interface RepoOpResult {
  ok: boolean;
  message: string;
  repo?: LinkedRepo;
}

/**
 * Lists every repo directly inside the workspace folder: a symlink to a
 * clone that lives elsewhere (see addRepo), or a plain directory holding a
 * direct clone (see cloneRepo — the default for new repos). A symlink whose
 * target has been deleted is still reported, flagged `broken: true`, rather
 * than silently omitted — see the panel's Repair action for how those get
 * cleaned up. Plain directories that aren't actually git repos are ignored,
 * so only this extension's own repos show up here, not e.g. AGENTS.md or
 * other files/folders a user might drop into the folder directly.
 */
export async function listLinkedRepos(folderPath: string): Promise<LinkedRepo[]> {
  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const repos: LinkedRepo[] = [];
  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        const target = await fs.realpath(entryPath);
        repos.push({ name: entry.name, target, isSymlink: true });
      } catch {
        repos.push({ name: entry.name, isSymlink: true, broken: true });
      }
      continue;
    }
    if (entry.isDirectory() && fsSync.existsSync(path.join(entryPath, '.git'))) {
      repos.push({ name: entry.name, target: entryPath, isSymlink: false });
    }
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

interface RepoCandidate {
  name: string;
  path: string;
}

/** Symlinks one candidate into the workspace folder, prompting to replace an
 * existing entry of the same name rather than silently clobbering it.
 * Returns undefined if the user declines the replace confirmation. */
async function linkOneRepo(
  workspaceFolderPath: string,
  candidate: RepoCandidate,
): Promise<LinkedRepo | undefined> {
  const linkPath = path.join(workspaceFolderPath, candidate.name);
  if (fsSync.existsSync(linkPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `"${candidate.name}" already exists in the workspace folder. Replace it?`,
      { modal: true },
      'Replace',
    );
    if (overwrite !== 'Replace') return undefined;
    await fs.rm(linkPath, { recursive: true, force: true });
  }

  await fs.symlink(candidate.path, linkPath, 'dir');
  return { name: candidate.name, target: candidate.path, isSymlink: true };
}

/**
 * Resolves which workspace repo `linkName` corresponds to and records it in
 * repo-links.json — auto-matched (and recorded anyway, so the manifest is
 * authoritative once a repo's been linked at all) when the local folder
 * name already equals a workspace repo id; otherwise prompts, since a
 * folder linked under an arbitrary/renamed local name (e.g. a clone named
 * "engine-ui" that's really the "engine-dashboard" repo) can't be inferred
 * from the name alone. Returns false (nothing recorded) when the user
 * cancels the picker — callers must treat that as "don't link this folder"
 * rather than linking a repo this workspace doesn't actually track. Always
 * true when the workspace has no tracked repos yet (nothing to check
 * against, so nothing to reject either).
 */
async function resolveAndRecordRepoLink(
  workspaceFolderPath: string,
  linkName: string,
  workspaceRepoIds: string[],
): Promise<boolean> {
  if (workspaceRepoIds.length === 0) return true;

  const exact = workspaceRepoIds.find((id) => id.toLowerCase() === linkName.toLowerCase());
  if (exact) {
    await setRepoLink(workspaceFolderPath, linkName, exact);
    return true;
  }

  const picked = await vscode.window.showQuickPick(
    workspaceRepoIds.map((id) => ({ label: id })),
    {
      title: `Which workspace repo is "${linkName}"?`,
      placeHolder: "This folder's name doesn't match a workspace repo — pick which one it is",
    },
  );
  if (!picked) return false;
  await setRepoLink(workspaceFolderPath, linkName, picked.label);
  return true;
}

/**
 * Links one or more repos into the workspace folder via a manual
 * folder-browse dialog, multi-select — each links under its own folder
 * name (no rename prompt). Ends in real filesystem symlinks (never a silent
 * copy), so each linked repo stays a normal git working copy the user can
 * commit/push from directly. Returns an empty array if the user cancels the
 * dialog or every replace confirmation is declined.
 *
 * Once linked, resolves which workspace repo (workspaceRepoIds — pass [] if
 * unknown/unavailable) the link name corresponds to — see
 * resolveAndRecordRepoLink above. A folder that can't be matched to a known
 * workspace repo (an unrelated local folder, a typo'd name) is unlinked
 * again rather than left in the workspace as an untracked repo.
 */
export async function addRepo(
  workspaceFolderPath: string,
  workspaceRepoIds: string[] = [],
): Promise<LinkedRepo[]> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: true,
    openLabel: 'Link selected folder(s)',
  });
  if (!picked || picked.length === 0) return [];
  const candidates: RepoCandidate[] = picked.map((uri) => ({
    name: path.basename(uri.fsPath),
    path: uri.fsPath,
  }));

  const results: LinkedRepo[] = [];
  for (const candidate of candidates) {
    const linked = await linkOneRepo(workspaceFolderPath, candidate);
    if (!linked) continue;
    const known = await resolveAndRecordRepoLink(
      workspaceFolderPath,
      linked.name,
      workspaceRepoIds,
    );
    if (!known) {
      await fs.rm(path.join(workspaceFolderPath, linked.name), { force: true });
      vscode.window.showWarningMessage(
        `Actorium: "${linked.name}" isn't a repo tracked by this workspace — not linked.`,
      );
      continue;
    }
    results.push(linked);
  }
  return results;
}

/** Derives a filesystem-safe repo folder name from a git URL — everything
 * after the last "/" or ":" (the latter for scp-like `git@host:owner/repo`
 * syntax), with a trailing ".git" stripped. Used as the clone folder name
 * when the caller doesn't already know one — callers that DO already know
 * the repo's real name (a workspace repo's repo_id) should pass it
 * explicitly instead. */
export function deriveRepoNameFromUrl(url: string): string {
  const cleaned = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf(':'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function gitErrorMessage(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return '"git" not found on your PATH — install git first, then try again.';
  const stderr = (err as { stderr?: string })?.stderr;
  return stderr?.trim() || (err instanceof Error ? err.message : String(err));
}

/**
 * Clones a git URL directly into the workspace folder — same end state as
 * addRepo's browse flow (a repo the user can commit/push from directly),
 * just fetching a fresh clone instead of linking an existing local one, and
 * with no symlink indirection: the clone itself lives at
 * `<workspaceFolder>/<repoName>`, since there's no pre-existing local
 * checkout elsewhere that would need one.
 *
 * `name` is treated as a confirmed workspace repo id (both the per-row
 * "Clone" action and "Clone all" always pass one, straight from
 * getWorkspaceRepos' repo_id — see panel.ts) and recorded in repo-links.json
 * accordingly.
 */
export async function cloneRepo(
  workspaceFolderPath: string,
  url: string,
  name?: string,
): Promise<RepoOpResult> {
  const repoName = (name?.trim() || deriveRepoNameFromUrl(url)).trim();
  if (!repoName) return { ok: false, message: 'Could not derive a repo name from that URL.' };

  const clonePath = path.join(workspaceFolderPath, repoName);
  if (fsSync.existsSync(clonePath)) {
    return {
      ok: false,
      message: `"${repoName}" already exists in this workspace. Remove it first or use a different name.`,
    };
  }

  try {
    await execFile('git', ['clone', url, clonePath]);
  } catch (err) {
    return { ok: false, message: `Clone failed: ${gitErrorMessage(err)}` };
  }

  if (name?.trim()) {
    await setRepoLink(workspaceFolderPath, repoName, name.trim());
  }

  return {
    ok: true,
    message: `Cloned "${repoName}".`,
    repo: { name: repoName, target: clonePath, isSymlink: false },
  };
}

/**
 * Clones every given {name, url} candidate, collecting failures instead of
 * aborting the batch on the first one — mirrors addRepo's multi-select loop.
 */
export async function cloneAllRepos(
  workspaceFolderPath: string,
  candidates: { name: string; url: string }[],
): Promise<{ linked: LinkedRepo[]; failures: { name: string; message: string }[] }> {
  const linked: LinkedRepo[] = [];
  const failures: { name: string; message: string }[] = [];
  for (const candidate of candidates) {
    const result = await cloneRepo(workspaceFolderPath, candidate.url, candidate.name);
    if (result.ok && result.repo) linked.push(result.repo);
    else failures.push({ name: candidate.name, message: result.message });
  }
  return { linked, failures };
}

/**
 * Unlinks a repo — removes its symlink from the workspace folder without
 * touching the real clone it points to. Refuses to touch anything that
 * isn't actually a symlink (a plain directory dropped in some other way),
 * so this can never rm -rf a real working copy.
 */
export async function unlinkRepo(workspaceFolderPath: string, name: string): Promise<RepoOpResult> {
  const linkPath = path.join(workspaceFolderPath, name);
  let stat: fsSync.Stats;
  try {
    stat = await fs.lstat(linkPath);
  } catch {
    return { ok: false, message: `"${name}" isn't linked in this workspace.` };
  }
  if (!stat.isSymbolicLink()) {
    return {
      ok: false,
      message: `"${name}" isn't a linked repo (it's a real directory) — refusing to remove it.`,
    };
  }
  await fs.rm(linkPath, { force: true });
  await removeRepoLink(workspaceFolderPath, name);
  return { ok: true, message: `Unlinked "${name}".` };
}

/**
 * Cleans up a broken symlink — one whose target was deleted out from under
 * the workspace (see listLinkedRepos' `broken` flag) — by removing the
 * dangling link itself and its now-stale repo-links.json entry. Used by the
 * panel's "Repair" action; unlike unlinkRepo this doesn't require the caller
 * to already know it's a symlink, since a broken entry can only be one.
 */
export async function removeBrokenLink(workspaceFolderPath: string, name: string): Promise<void> {
  await fs.rm(path.join(workspaceFolderPath, name), { force: true });
  await removeRepoLink(workspaceFolderPath, name);
}
