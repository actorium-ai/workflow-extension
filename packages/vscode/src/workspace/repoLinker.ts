import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface LinkedRepo {
  name: string;
  target: string;
}

/**
 * Lists every symlink directly inside the workspace folder — each one is a
 * linked repo (see addRepo below). Plain subdirectories are ignored, so only
 * this extension's own links show up here, not e.g. AGENTS.md or other files
 * a user might drop into the folder directly.
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
    if (!entry.isSymbolicLink()) continue;
    try {
      const target = await fs.realpath(path.join(folderPath, entry.name));
      repos.push({ name: entry.name, target });
    } catch {
      // dangling symlink — skip
    }
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function searchRoots(): string[] {
  const configured = vscode.workspace.getConfiguration('actorium').get<string[]>('repoSearchPaths');
  if (configured && configured.length > 0) return configured.map(expandHome);
  return [path.join(os.homedir(), 'code')];
}

const SEARCH_DEPTH = 2;
const SEARCH_CAP = 200;

/**
 * Shallow scan under each configured search root (actorium.repoSearchPaths,
 * default ~/code) for directories that look like git clones (contain a
 * .git entry) — feeds addRepo's auto-search picker. Never descends into a
 * repo's own subdirectories once found, and stops at SEARCH_CAP matches so a
 * huge tree can't hang the picker.
 */
async function findCandidateRepos(): Promise<{ name: string; path: string }[]> {
  const results: { name: string; path: string }[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= SEARCH_CAP) return;
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= SEARCH_CAP) return;
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (fsSync.existsSync(path.join(full, '.git'))) {
        results.push({ name: entry.name, path: full });
        continue;
      }
      if (depth > 0) await walk(full, depth - 1);
    }
  }

  for (const root of searchRoots()) {
    await walk(root, SEARCH_DEPTH);
  }
  return results;
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
  return { name: candidate.name, target: candidate.path };
}

/**
 * Links one or more repos into the workspace folder — offers an auto-search
 * over configured local paths for existing git clones, plus a manual
 * folder-browse fallback, both multi-select. Either way ends in real
 * filesystem symlinks (never a silent copy), so each linked repo stays a
 * normal git working copy the user can commit/push from directly. Returns an
 * empty array if the user cancels any step or every replace confirmation is
 * declined.
 *
 * A single selection still prompts to customize the link name (its own
 * folder name is just the default) — for a multi-select batch, prompting
 * once per repo would be tedious busywork, so those link directly under
 * their own folder names instead.
 */
export async function addRepo(workspaceFolderPath: string): Promise<LinkedRepo[]> {
  const modeChoice = await vscode.window.showQuickPick(
    [
      {
        label: '$(search) Auto-search',
        description: 'Scan local folders for matching clones',
        action: 'search' as const,
      },
      {
        label: '$(folder-opened) Browse…',
        description: 'Pick folder(s) manually',
        action: 'browse' as const,
      },
    ],
    { title: 'Add repos to this workspace' },
  );
  if (!modeChoice) return [];

  let candidates: RepoCandidate[];

  if (modeChoice.action === 'search') {
    const found = await findCandidateRepos();
    if (found.length === 0) {
      vscode.window.showInformationMessage(
        'Actorium: No git clones found under the configured search paths (see the actorium.repoSearchPaths setting).',
      );
      return [];
    }
    const picked = await vscode.window.showQuickPick(
      found.map((c) => ({ label: c.name, description: c.path, candidate: c })),
      { title: 'Select repos to link', matchOnDescription: true, canPickMany: true },
    );
    if (!picked || picked.length === 0) return [];
    candidates = picked.map((p) => p.candidate);
  } else {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: true,
      openLabel: 'Link selected folder(s)',
    });
    if (!picked || picked.length === 0) return [];
    candidates = picked.map((uri) => ({ name: path.basename(uri.fsPath), path: uri.fsPath }));
  }

  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (!candidate) return [];
    const linkName = await vscode.window.showInputBox({
      prompt: 'Name for this repo inside the workspace folder',
      value: candidate.name,
      validateInput: (v) => (v.trim() ? undefined : 'Required'),
    });
    if (!linkName) return [];
    const linked = await linkOneRepo(workspaceFolderPath, { name: linkName, path: candidate.path });
    return linked ? [linked] : [];
  }

  const results: LinkedRepo[] = [];
  for (const candidate of candidates) {
    const linked = await linkOneRepo(workspaceFolderPath, candidate);
    if (linked) results.push(linked);
  }
  return results;
}
