import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

const WORKSPACE_FOLDERS_KEY = 'actorium.workspaceFolders';

type FolderMap = Record<string, string>;

function getFolderMap(context: vscode.ExtensionContext): FolderMap {
  return context.globalState.get<FolderMap>(WORKSPACE_FOLDERS_KEY) ?? {};
}

async function setWorkspaceFolder(
  context: vscode.ExtensionContext,
  workspaceId: string,
  folderPath: string,
): Promise<void> {
  const map = getFolderMap(context);
  map[workspaceId] = folderPath;
  await context.globalState.update(WORKSPACE_FOLDERS_KEY, map);
}

/**
 * Returns the folder linked to `workspaceId`, or undefined if none is linked
 * yet or the linked path no longer exists on disk (moved/deleted) — treated
 * as "not linked" rather than a broken reference, since ensureWorkspaceFolder
 * below re-prompts in that case instead of failing later at symlink time.
 *
 * Keyed by workspace, not org: two workspaces under the same org are
 * different projects with different repos, so they each need their own
 * folder/symlinks/AGENTS.md — sharing one org-wide folder previously meant
 * switching workspaces (within the same org) kept showing whichever
 * workspace's repos were linked last, since both are pulled out of what was
 * actually the same physical folder.
 */
export function getWorkspaceFolder(
  context: vscode.ExtensionContext,
  workspaceId: string,
): string | undefined {
  const folder = getFolderMap(context)[workspaceId];
  return folder && fsSync.existsSync(folder) ? folder : undefined;
}

/**
 * Ensures `workspaceId` has a local workspace folder linked — a plain
 * container directory (not itself a git repo) that individual project clones
 * get symlinked into (see repoLinker.ts) and where AGENTS.md is generated
 * (see agentsFile.ts). Prompts once per workspace; returns undefined if the
 * user cancels any step.
 */
export async function ensureWorkspaceFolder(
  context: vscode.ExtensionContext,
  workspaceId: string,
  workspaceLabel: string,
): Promise<string | undefined> {
  const existing = getWorkspaceFolder(context, workspaceId);
  if (existing) return existing;

  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(new-folder) Create new folder', action: 'create' as const },
      { label: '$(folder-opened) Choose existing folder', action: 'choose' as const },
    ],
    {
      title: `Link a workspace folder for "${workspaceLabel}"`,
      placeHolder: 'Actorium keeps your linked repos and AGENTS.md here',
    },
  );
  if (!choice) return undefined;

  let folderPath: string | undefined;
  if (choice.action === 'choose') {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Use as workspace folder',
    });
    folderPath = picked?.[0]?.fsPath;
  } else {
    const parent = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Select parent directory',
    });
    const parentPath = parent?.[0]?.fsPath;
    if (!parentPath) return undefined;

    const name = await vscode.window.showInputBox({
      prompt: 'New workspace folder name',
      value: workspaceLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      validateInput: (v) => (v.trim() ? undefined : 'Required'),
    });
    if (!name) return undefined;

    folderPath = path.join(parentPath, name);
    await fs.mkdir(folderPath, { recursive: true });
  }

  if (!folderPath) return undefined;
  await setWorkspaceFolder(context, workspaceId, folderPath);
  return folderPath;
}
