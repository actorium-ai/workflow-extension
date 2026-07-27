import { AtSign, CloudDownload, FolderGit2, FolderX, Link2, Unlink } from 'lucide-react';

import type { LinkedRepo } from '../utils/types.ts';

function repoTag(repo: LinkedRepo): string {
  return `repo "${repo.name}"`;
}

interface WorkspacePanelProps {
  repos: LinkedRepo[];
  hasWorkspaceFolder: boolean;
  onOpenWorkspaceFolder: () => void;
  /** Opens the add-repo flow (search/browse + symlink) — see the extension
   * host's src/workspace/repoLinker.ts addRepo. Used both by the section's
   * own "+" header action and by each unlinked repo row below. */
  onAddRepo: () => void;
  /** Removes a linked repo's symlink from the workspace folder (the real
   * clone it points to is untouched) — see repoLinker.ts's unlinkRepo. */
  onUnlinkRepo: (name: string) => void;
  /** Clones a not-yet-linked-but-known workspace repo directly from its
   * repo_url — see repoLinker.ts's cloneRepo. Only rendered when the repo
   * has a known URL (repo.repoUrl). */
  onCloneRepo: (repo: LinkedRepo) => void;
  /** Inserts a plain-text reference to a repo into the active terminal (or
   * clipboard, if none) — see NavigatorPanelProvider's tagInPrompt handler
   * and FeatureList/DocList's matching onTagInPrompt. */
  onTagInPrompt: (text: string) => void;
}

/** Lists every repo this workspace tracks (fetched from workflow-backend,
 * cross-referenced against what's really present in the local workspace
 * folder — see the extension host's src/navigator/panel.ts _loadRepos) and
 * lets the user add more or jump into the folder. A repo the workspace knows
 * about but that has no local clone/link yet renders as "not linked", with a
 * Link action instead of the usual open/tag actions, since there's no local
 * file to open or reference in a prompt yet. Clicking a linked row just opens
 * the workspace root (in the current window) rather than a separate
 * "just this repo" folder — the root's Explorer already surfaces it.
 *
 * A linked repo is either a direct clone (the default for new repos) or a
 * symlink to a clone that lives elsewhere (added via "Actorium: Add Repo") —
 * only the latter can go "broken" (its target deleted out from under the
 * workspace), rendered as a distinct row below rather than silently looking
 * unlinked; the section's "Repair" action clears it. */
export function WorkspacePanel({
  repos,
  hasWorkspaceFolder,
  onOpenWorkspaceFolder,
  onAddRepo,
  onUnlinkRepo,
  onCloneRepo,
  onTagInPrompt,
}: WorkspacePanelProps) {
  if (!hasWorkspaceFolder) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-3 text-center">
        <p className="text-xs text-text-muted">
          Link a local folder to work on this workspace with Claude Code or another local coding
          agent.
        </p>
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary-hover"
          onClick={onOpenWorkspaceFolder}
        >
          Link workspace folder
        </button>
      </div>
    );
  }

  return (
    <div className="px-1">
      {repos.length === 0 ? (
        <div className="px-2 py-3 text-center text-xs text-text-muted">No repos linked yet.</div>
      ) : (
        repos.map((repo) =>
          repo.linked && repo.broken ? (
            <div
              key={repo.name}
              className="group flex w-full items-center gap-1.5 rounded-md pr-1 hover:bg-surface-secondary"
            >
              <span
                title={`"${repo.linkName ?? repo.name}" was linked here, but the local folder it pointed to was deleted. Use the section's "Repair" action to clean this up.`}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5"
              >
                <Unlink className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{repo.name}</span>
              </span>
            </div>
          ) : repo.linked ? (
            <div
              key={repo.name}
              className="group flex w-full items-center gap-1.5 rounded-md pr-1 hover:bg-surface-secondary"
            >
              <button
                type="button"
                title={
                  repo.linkName ? `Linked as "${repo.linkName}" → ${repo.target}` : repo.target
                }
                onClick={onOpenWorkspaceFolder}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
              >
                <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                  {repo.name}
                  {repo.linkName && (
                    <span className="ml-1 text-text-muted">(linked as {repo.linkName})</span>
                  )}
                </span>
              </button>
              <button
                type="button"
                title="Tag this repo in the terminal prompt"
                onClick={() => onTagInPrompt(repoTag(repo))}
                className="shrink-0 rounded p-1 text-text-muted opacity-0 hover:bg-surface-secondary hover:text-text-primary group-hover:opacity-100"
              >
                <AtSign className="h-3 w-3 shrink-0" aria-hidden="true" />
              </button>
              {repo.isSymlink && (
                <button
                  type="button"
                  title={`Unlink "${repo.linkName ?? repo.name}"`}
                  onClick={() => onUnlinkRepo(repo.linkName ?? repo.name)}
                  className="shrink-0 rounded p-1 text-text-muted opacity-0 hover:bg-surface-secondary hover:text-danger group-hover:opacity-100"
                >
                  <Unlink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </button>
              )}
            </div>
          ) : (
            <div
              key={repo.name}
              className="group flex w-full items-center gap-1.5 rounded-md pr-1 hover:bg-surface-secondary"
            >
              <span
                title="Not linked locally yet"
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5"
              >
                <FolderX className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{repo.name}</span>
              </span>
              {repo.repoUrl && (
                <button
                  type="button"
                  title={`Clone "${repo.name}" from git`}
                  onClick={() => onCloneRepo(repo)}
                  className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-warning opacity-0 hover:bg-surface-secondary group-hover:opacity-100"
                >
                  <CloudDownload className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Clone
                </button>
              )}
              <button
                type="button"
                title={`Link "${repo.name}" to this workspace folder`}
                onClick={onAddRepo}
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-warning opacity-0 hover:bg-surface-secondary group-hover:opacity-100"
              >
                <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                Link
              </button>
            </div>
          ),
        )
      )}
    </div>
  );
}
