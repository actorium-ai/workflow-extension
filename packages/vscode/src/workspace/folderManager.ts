import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';

const WORKSPACE_FOLDERS_KEY = 'actorium.workspaceFolders';
const PENDING_SYNC_KEY = 'actorium.pendingWorkspaceSync';

type FolderMap = Record<string, string>;

interface PendingWorkspaceSync {
  folderPath: string;
  workspaceId: string;
  workspaceLabel: string;
  orgId: string | null;
}

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
 * user cancels.
 *
 * A single folder-browse dialog handles both "use an existing folder" and
 * "create a new one" — every OS's native picker already lets you create and
 * navigate into a new folder before confirming, so the selected directory
 * itself becomes the workspace folder directly rather than asking the user
 * to pick a parent and type a name for this extension to mkdir separately.
 */
export async function ensureWorkspaceFolder(
  context: vscode.ExtensionContext,
  workspaceId: string,
  workspaceLabel: string,
): Promise<string | undefined> {
  const existing = getWorkspaceFolder(context, workspaceId);
  if (existing) return existing;

  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Use as workspace folder',
    title: `Link a workspace folder for "${workspaceLabel}"`,
  });
  const folderPath = picked?.[0]?.fsPath;
  if (!folderPath) return undefined;

  await fs.mkdir(folderPath, { recursive: true });
  await setWorkspaceFolder(context, workspaceId, folderPath);
  return folderPath;
}

/**
 * Stashes a workspace selection to survive a `vscode.openFolder` reload —
 * needed because AuthManager's selection normally lives in `workspaceState`,
 * which VS Code scopes per opened folder. When switching workspace reopens
 * the window into a *different* folder (syncWindowToWorkspace, below), the
 * write AuthManager just made landed in the folder that was open before the
 * reload, not the one now open, so the new folder restores whatever (stale)
 * selection it happened to have from an earlier session instead. Stashing
 * here in `globalState` — not folder-scoped — lets the next activation
 * recover the selection that was actually just picked.
 */
export async function stashPendingWorkspaceSync(
  context: vscode.ExtensionContext,
  sync: PendingWorkspaceSync,
): Promise<void> {
  await context.globalState.update(PENDING_SYNC_KEY, sync);
}

/**
 * Consumes (one-shot: always clears, even on a mismatch) a pending sync
 * stashed above. Only returns it if `currentFolderPath` matches the folder
 * the sync was stashed for — otherwise this is some unrelated activation
 * (e.g. the user later opened a different folder by hand) and the stale
 * marker should just be dropped rather than misapplied.
 */
export async function consumePendingWorkspaceSync(
  context: vscode.ExtensionContext,
  currentFolderPath: string | undefined,
): Promise<PendingWorkspaceSync | undefined> {
  const pending = context.globalState.get<PendingWorkspaceSync>(PENDING_SYNC_KEY);
  if (!pending) return undefined;
  await context.globalState.update(PENDING_SYNC_KEY, undefined);
  return pending.folderPath === currentFolderPath ? pending : undefined;
}
