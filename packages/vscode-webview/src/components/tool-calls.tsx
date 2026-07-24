import {
  ChevronRight,
  Diff,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  GitCommit,
  List,
  Loader2,
  type LucideIcon,
  Pencil,
  Search,
  Terminal,
  Upload,
  Wrench,
} from 'lucide-react';

import type { ToolCallState } from '../utils/types.ts';
import {
  computeEditStats,
  extractPatch,
  extractRealDiffStats,
  formatOutput,
  formatToolCallLabel,
} from '../utils/utils.ts';
import { DiffView } from './diff-view';

const TOGGLE_CLASS =
  'inline-flex items-center gap-1.5 self-start rounded px-1 py-0.5 text-xs text-text-muted hover:bg-surface-secondary hover:text-text-primary';
const TOGGLE_INERT_CLASS =
  'inline-flex items-center gap-1.5 self-start rounded px-1 py-0.5 text-xs text-text-muted';

/** Per-tool icon for the IDE's own client-executed (deferred) tools — falls
 * back to the generic Wrench for every server-side tool (query_rag,
 * get_workspace_context, etc.) and anything unrecognized. */
const TOOL_ICONS: Record<string, LucideIcon> = {
  read_file: FileText,
  edit_file: Pencil,
  write_file: FilePlus,
  create_directory: FolderPlus,
  browse_directory: Folder,
  search_code: Search,
  search_files: Search,
  run_command: Terminal,
  git_status: GitBranch,
  git_diff: Diff,
  git_commit: GitCommit,
  git_push: Upload,
  git_checkout: GitBranch,
  git_log: List,
};

/** Picks and renders one of TOOL_ICONS (or the running spinner) — a
 * dedicated component, not a bare variable, so the icon selection happens
 * inside its own render rather than a parent's (react-hooks/static-components
 * flags a component reference stored in a parent's local variable, even
 * when just selecting among fixed, stable components). */
function ToolIcon({
  name,
  running,
  className,
}: {
  name: string;
  running: boolean;
  className: string;
}) {
  const Icon = running ? Loader2 : (TOOL_ICONS[name] ?? Wrench);
  return <Icon className={className + (running ? ' animate-spin' : '')} />;
}

interface ToolCallRowProps {
  turnId: string;
  tc: ToolCallState;
  onToggleOutput: (turnId: string, callId: string) => void;
}

/**
 * A single tool call's activity row, rendered inline at its actual position
 * in the turn's ordered segments (see AssistantSegment) — not grouped behind
 * a collapse-all toggle the way multiple tool calls used to be, since a
 * group toggle only made sense when every tool call rendered as one block
 * after all the text. Each row still has its own show/hide toggle for its
 * raw output.
 */
export function ToolCallRow({ turnId, tc, onToggleOutput }: ToolCallRowProps) {
  // read_file's output is just the file content the model already asked for
  // and is about to act on — showing it again in an expandable raw-JSON dump
  // underneath the row is pure noise, unlike edit_file/write_file's diff or
  // a search/command tool's actual result.
  const hasOutput =
    tc.name !== 'read_file' &&
    tc.status === 'done' &&
    tc.output !== undefined &&
    tc.output !== null &&
    formatOutput(tc.output).trim().length > 0;
  const expanded = !!tc.expanded;
  const running = tc.status === 'running';
  const isDiffTool = tc.name === 'edit_file' || tc.name === 'write_file';
  // Prefer the real stat from the completed result (computed from actual
  // before/after file content — see FileOps.editFile/writeFile) over the
  // params-based heuristic, which only exists to show something while the
  // call is still running (write_file has no such heuristic at all — its
  // params carry the new content but not the old, so it shows nothing until
  // the real result arrives).
  const editStats = isDiffTool
    ? ((tc.status === 'done' ? extractRealDiffStats(tc.output) : null) ??
      computeEditStats(tc.params))
    : null;
  const patch = isDiffTool && tc.status === 'done' ? extractPatch(tc.output) : null;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className={
          hasOutput ? TOGGLE_CLASS + ' cursor-pointer' : TOGGLE_INERT_CLASS + ' cursor-default'
        }
        onClick={() => hasOutput && onToggleOutput(turnId, tc.callId)}
      >
        <ToolIcon name={tc.name} running={running} className="h-3 w-3 shrink-0" />
        <span>{formatToolCallLabel(tc.name, tc.params)}</span>
        {editStats && (
          <span className="shrink-0 font-mono">
            <span className="text-success">+{editStats.added}</span>{' '}
            <span className="text-danger">-{editStats.removed}</span>
          </span>
        )}
        {running && <span className="opacity-60">…</span>}
        {hasOutput && (
          <ChevronRight
            className={
              'h-3 w-3 shrink-0 opacity-70 transition-transform' + (expanded ? ' rotate-90' : '')
            }
          />
        )}
      </button>
      {hasOutput &&
        expanded &&
        (patch ? (
          <DiffView patch={patch} />
        ) : (
          <pre className="mt-0.5 max-h-56 overflow-auto rounded-md bg-code-bg px-2 py-1.5 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words">
            {formatOutput(tc.output)}
          </pre>
        ))}
    </div>
  );
}
