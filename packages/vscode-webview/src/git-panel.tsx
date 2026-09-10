import { GitBranch, GitCommit, RefreshCw, TriangleAlert } from 'lucide-react';

import { SectionState } from './components/section-state.tsx';
import {
  type GitChangedFile,
  type GitChangeStatus,
  useGitPanelController,
} from './state/use-git-panel-controller.ts';

/** Single-letter status badge, same convention as VS Code's own Source
 * Control view (A/M/D/R colored letters) rather than icon glyphs — reads at
 * a glance in a dense file list. */
const STATUS_BADGE: Record<GitChangeStatus, { letter: string; color: string }> = {
  added: { letter: 'A', color: 'text-success' },
  modified: { letter: 'M', color: 'text-warning' },
  deleted: { letter: 'D', color: 'text-danger' },
  renamed: { letter: 'R', color: 'text-accent-foreground' },
  other: { letter: '?', color: 'text-text-muted' },
};

function RepoPicker({
  repos,
  selectedRepoPath,
  onSelect,
}: {
  repos: { name: string; path: string }[];
  selectedRepoPath: string | null;
  onSelect: (path: string) => void;
}) {
  if (repos.length === 0) return null;
  return (
    <select
      value={selectedRepoPath ?? ''}
      onChange={(e) => onSelect(e.target.value)}
      className="min-w-0 max-w-[45%] shrink truncate rounded border border-border bg-surface px-1.5 py-1 text-xs text-text-primary outline-none"
    >
      {repos.map((r) => (
        <option key={r.path} value={r.path}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

function BranchRow({
  name,
  current,
  onSelect,
  onContextMenu,
}: {
  name: string;
  current: boolean;
  selected: boolean;
  onSelect: () => void;
  onContextMenu?: () => void;
}) {
  return (
    <button
      type="button"
      title={name}
      onClick={onSelect}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu();
      }}
      className={
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-surface-secondary' +
        (current ? ' font-semibold text-text-primary' : ' text-text-secondary')
      }
    >
      <GitBranch className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </button>
  );
}

function BranchTree({
  head,
  local,
  remote,
  selectedRef,
  onSelectRef,
  onCheckout,
}: {
  head?: string;
  local: string[];
  remote: string[];
  selectedRef: string | undefined;
  onSelectRef: (ref: string | undefined) => void;
  onCheckout: (branch: string) => void;
}) {
  return (
    <div className="w-40 shrink-0 overflow-y-auto border-r border-border py-1 pr-1">
      {head && (
        <div className="mb-1">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            HEAD
          </div>
          <BranchRow
            name={head}
            current={!selectedRef}
            selected={!selectedRef}
            onSelect={() => onSelectRef(undefined)}
          />
        </div>
      )}
      {local.length > 0 && (
        <div className="mb-1">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Local
          </div>
          {local.map((name) => (
            <BranchRow
              key={name}
              name={name}
              current={name === head}
              selected={selectedRef === name}
              onSelect={() => onSelectRef(name)}
              onContextMenu={() => onCheckout(name)}
            />
          ))}
        </div>
      )}
      {remote.length > 0 && (
        <div>
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Remote
          </div>
          {remote.map((name) => (
            <BranchRow
              key={name}
              name={name}
              current={false}
              selected={selectedRef === name}
              onSelect={() => onSelectRef(name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommitDetails({ files }: { files: GitChangedFile[] }) {
  if (files.length === 0) {
    return <div className="px-4 py-2 text-[11px] text-text-muted">No files changed.</div>;
  }
  return (
    <div className="border-t border-border bg-surface px-2 py-1.5">
      {files.map((f) => {
        const badge = STATUS_BADGE[f.status];
        return (
          <div key={f.path} className="flex items-center gap-2 px-2 py-0.5 text-[11px]">
            <span className={`w-3 shrink-0 text-center font-semibold ${badge.color}`}>
              {badge.letter}
            </span>
            <span className="min-w-0 flex-1 truncate text-text-secondary">{f.path}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/**
 * JetBrains-style Git tool window — a bottom-panel view (see package.json's
 * "actorium-git" viewsContainers.panel entry) showing one repo's branch
 * tree + commit log at a time, with a picker across every repo the current
 * workspace has linked. Mirrors GitPanelProvider's postMessage protocol
 * 1:1 (see use-git-panel-controller.ts).
 */
export function GitPanel() {
  const c = useGitPanelController();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {c.error && (
        <div className="flex items-center gap-1.5 border-b border-border bg-danger/10 px-2 py-1 text-[11px] text-danger">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{c.error}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <RepoPicker repos={c.repos} selectedRepoPath={c.selectedRepoPath} onSelect={c.selectRepo} />
        <div className="flex-1" />
        <button
          type="button"
          title="Pull latest"
          disabled={c.pulling || !c.selectedRepoPath}
          onClick={c.pull}
          className="flex shrink-0 items-center gap-1 rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-text-primary disabled:pointer-events-none disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 shrink-0 ${c.pulling ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {c.repos.length === 0 ? (
        <SectionState kind="empty" message="No linked repos yet." />
      ) : (
        <div className="flex min-h-0 flex-1">
          <BranchTree
            head={c.branches.head}
            local={c.branches.local}
            remote={c.branches.remote}
            selectedRef={c.selectedRef}
            onSelectRef={c.selectRef}
            onCheckout={c.checkoutBranch}
          />
          <div className="min-w-0 flex-1 overflow-y-auto">
            {c.commitsLoading && c.commits.length === 0 ? (
              <SectionState kind="loading" message="Loading commits…" />
            ) : c.commits.length === 0 ? (
              <SectionState kind="empty" message="No commits yet." />
            ) : (
              <>
                {c.commits.map((commit) => (
                  <div key={commit.hash} className="border-b border-border">
                    <button
                      type="button"
                      onClick={() => c.selectCommit(commit.hash)}
                      className={
                        'flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-secondary' +
                        (c.selectedCommit === commit.hash ? ' bg-surface-secondary' : '')
                      }
                    >
                      <GitCommit className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                        {commit.message.split('\n')[0]}
                      </span>
                      <span className="shrink-0 text-[10px] text-text-muted">
                        {commit.authorName}
                      </span>
                      <span className="shrink-0 text-[10px] text-text-muted">
                        {formatDate(commit.authorDate)}
                      </span>
                    </button>
                    {c.selectedCommit === commit.hash && <CommitDetails files={c.commitFiles} />}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={c.loadMoreCommits}
                  className="w-full px-2 py-2 text-center text-[11px] text-text-muted hover:bg-surface-secondary hover:text-text-primary"
                >
                  Load more
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
