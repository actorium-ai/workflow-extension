import {
  Activity as ActivityIcon,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleMinus,
  CircleX,
  ExternalLink,
  Filter,
  RotateCcw,
  Unlock,
  X,
  Zap,
} from 'lucide-react';
import { marked } from 'marked';
import type { ComponentType, MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { TaskStatusGlyph } from './components/status-glyph.tsx';
import { lifecycleMeta, taskStatusMeta, tint } from './utils/feature-meta.ts';
import { deriveIconColor } from './utils/icon-colors.ts';
import { getInitialFeature } from './utils/panel-context.ts';
import type {
  ActivityEvent,
  FeatureHandoff,
  HandoffPR,
  TaskDetail,
  TaskDiff,
  TaskSummary,
} from './utils/types.ts';
import { getVsCodeApi } from './utils/vscode-api.ts';

const vscode = getVsCodeApi();

type BaseTabKey = 'product_spec' | 'tech_design' | 'tasks' | 'handoff' | 'activity';
type TabKey = BaseTabKey | `task:${string}`;

const BASE_TABS: { key: BaseTabKey; label: string }[] = [
  { key: 'product_spec', label: 'Product Spec' },
  { key: 'tech_design', label: 'Tech Design' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'handoff', label: 'Handoff' },
  { key: 'activity', label: 'Activity' },
];

interface DetailState {
  docs: Record<string, string | null>;
  tasks: TaskSummary[];
  handoff: FeatureHandoff | null;
  activity: ActivityEvent[];
  loaded: boolean;
}

function MarkdownDoc({ content }: { content: string | null | undefined }) {
  if (content === null || content === undefined) {
    return <div className="text-xs text-text-muted">No content yet.</div>;
  }
  const html = marked.parse(content, { async: false }) as string;
  // Content is our own workspace's spec/design docs, not arbitrary
  // third-party HTML — and the page's own CSP (script-src 'nonce-...') blocks
  // any injected <script> from executing regardless, so this is safe within
  // the existing trust boundary.
  return (
    <div
      className="actorium-markdown text-xs text-text-primary"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

function formatTimestamp(occurredAt: string): string {
  const d = new Date(occurredAt);
  if (Number.isNaN(d.getTime())) return occurredAt;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Per-action dot glyph + color, keyed on the EXACT display labels
 * workflow-backend's clientAudienceAllowlist maps raw action names to
 * (audience=client, which getFeatureActivity always requests) — reflects
 * what HAPPENED at that point in the log, distinct from the task's CURRENT
 * status pill shown on the right of each row. */
const ACTION_META: Record<string, { color: string; icon: ComponentType<{ size?: number }> }> = {
  Created: { color: 'var(--color-text-secondary)', icon: Circle },
  Ready: { color: 'var(--color-purple)', icon: Zap },
  Started: { color: 'var(--color-primary)', icon: CircleDashed },
  Progress: { color: 'var(--color-primary)', icon: CircleDashed },
  Completed: { color: 'var(--color-success)', icon: CheckCircle2 },
  Approved: { color: 'var(--color-success)', icon: CheckCircle2 },
  Reviewed: { color: 'var(--color-purple)', icon: CheckCircle2 },
  Blocked: { color: 'var(--color-danger)', icon: CircleX },
  Rejected: { color: 'var(--color-danger)', icon: CircleX },
  Unblocked: { color: 'var(--color-warning)', icon: Unlock },
  Recovered: { color: 'var(--color-success)', icon: RotateCcw },
  Reopened: { color: 'var(--color-warning)', icon: RotateCcw },
  Cancelled: { color: 'var(--color-text-muted)', icon: CircleMinus },
  'Model changed': { color: 'var(--color-text-muted)', icon: Circle },
};
const DEFAULT_ACTION_META = { color: 'var(--color-text-secondary)', icon: Circle };

function actionMeta(action: string) {
  return ACTION_META[action] ?? DEFAULT_ACTION_META;
}

/** "orchestrator" is a fixed system actor (not a real user), so it gets a
 * fixed bot glyph instead of a hash-derived colored-initials circle. */
function ActorAvatar({ actor, actorId }: { actor: string; actorId?: string }) {
  if (actor.toLowerCase() === 'orchestrator') {
    return (
      <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning">
        <Bot className="h-3 w-3" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
      style={{ background: deriveIconColor(actorId ?? actor ?? '?') }}
    >
      {initial(actor || '?')}
    </span>
  );
}

function ActivityTimeline({ events, tasks }: { events: ActivityEvent[]; tasks: TaskSummary[] }) {
  const [filterActor, setFilterActor] = useState<string>('');
  const [filterOpen, setFilterOpen] = useState(false);

  const actors = useMemo(
    () => Array.from(new Set(events.map((e) => e.actor).filter(Boolean))).sort(),
    [events],
  );
  const filtered = useMemo(
    () => (filterActor ? events.filter((e) => e.actor === filterActor) : events),
    [events, filterActor],
  );
  const taskById = useMemo(() => {
    const m = new Map<string, TaskSummary>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
          <ActivityIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Activity
          <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-normal text-text-muted">
            {events.length}
          </span>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-secondary"
          >
            <Filter className="h-3 w-3" aria-hidden="true" />
            {filterActor || 'Filter'}
          </button>
          {filterOpen && (
            <div className="absolute right-0 z-10 mt-1 max-h-56 min-w-32 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  setFilterActor('');
                  setFilterOpen(false);
                }}
                className="block w-full px-3 py-1 text-left text-[11px] text-text-secondary hover:bg-surface-secondary"
              >
                All actors
              </button>
              {actors.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    setFilterActor(a);
                    setFilterOpen(false);
                  }}
                  className="block w-full truncate px-3 py-1 text-left text-[11px] text-text-secondary hover:bg-surface-secondary"
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-xs text-text-muted">No activity yet.</div>
      ) : (
        <div className="relative flex flex-col gap-2 pl-1">
          <div className="absolute bottom-3 left-[9px] top-3 w-px bg-border" aria-hidden="true" />
          {filtered.map((e, i) => {
            const task = e.task_id ? taskById.get(e.task_id) : undefined;
            const meta = actionMeta(e.action);
            const Icon = meta.icon;
            const pillMeta = task ? taskStatusMeta(task.status) : null;
            return (
              <div key={i} className="relative flex gap-2.5">
                <span
                  className="relative z-[1] mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-surface"
                  style={{ color: meta.color }}
                >
                  <Icon size={16} />
                </span>
                <ActorAvatar actor={e.actor} actorId={e.actor_id} />
                <div className="min-w-0 flex-1 rounded-md border border-border bg-surface-secondary/40 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className="text-xs font-medium text-text-primary">
                      {e.actor || 'Someone'}
                    </span>
                    <span className="text-xs font-medium" style={{ color: meta.color }}>
                      {e.action}
                    </span>
                    {task && (
                      <>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            color: 'var(--color-primary)',
                            background: tint('var(--color-primary)'),
                          }}
                        >
                          {task.task_name}
                        </span>
                        <span className="truncate text-xs text-text-secondary">{task.title}</span>
                      </>
                    )}
                    <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
                      <span className="text-[10px] text-text-muted">
                        {formatTimestamp(e.occurred_at)}
                      </span>
                      {pillMeta && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ color: pillMeta.color, background: tint(pillMeta.color) }}
                        >
                          {pillMeta.label}
                        </span>
                      )}
                    </div>
                  </div>
                  {e.note && (
                    <div className="mt-0.5 flex items-start gap-1 text-[11px] text-text-muted">
                      <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{e.note}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskList({
  tasks,
  onOpen,
}: {
  tasks: TaskSummary[];
  onOpen: (task: TaskSummary) => void;
}) {
  if (tasks.length === 0) {
    return <div className="text-xs text-text-muted">No tasks yet.</div>;
  }
  return (
    <div className="flex flex-col gap-1">
      {tasks.map((t, i) => {
        const meta = taskStatusMeta(t.status);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t)}
            title={t.next_action || undefined}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-secondary"
          >
            <TaskStatusGlyph status={t.status} />
            <span className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
              T{i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
              {t.title || t.task_name}
            </span>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ color: meta.color, background: tint(meta.color) }}
            >
              {meta.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TaskSpecPane({ detail }: { detail: TaskDetail }) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      {detail.next_action && (
        <div>
          <div className="mb-1 font-semibold text-text-primary">Next action</div>
          <div className="text-text-secondary">{detail.next_action}</div>
        </div>
      )}
      {detail.is_blocked && (
        <div>
          <div className="mb-1 font-semibold text-danger">Blocked</div>
          {detail.blocked_reason && (
            <div className="text-text-secondary">{detail.blocked_reason}</div>
          )}
          {detail.blocked_details && (
            <div className="mt-0.5 text-text-muted">{detail.blocked_details}</div>
          )}
        </div>
      )}
      {detail.depends_on.length > 0 && (
        <div>
          <div className="mb-1 font-semibold text-text-primary">Depends on</div>
          <div className="flex flex-wrap gap-1">
            {detail.depends_on.map((d) => (
              <span
                key={d}
                className="rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] text-text-secondary"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
      {detail.pr_refs && detail.pr_refs.length > 0 && (
        <div>
          <div className="mb-1 font-semibold text-text-primary">Pull requests</div>
          <div className="flex flex-col gap-1">
            {detail.pr_refs.map((pr) => (
              <button
                key={pr.url}
                type="button"
                onClick={() => vscode.postMessage({ command: 'openExternalUrl', url: pr.url })}
                className="flex items-center gap-1.5 text-left text-accent hover:underline"
              >
                <span className="font-mono text-text-secondary">{pr.repo}</span>
                {pr.label}
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}
      {detail.activity.length > 0 && (
        <div>
          <div className="mb-1 font-semibold text-text-primary">Activity</div>
          <div className="flex flex-col gap-1.5">
            {detail.activity.map((e, i) => (
              <div key={i} className="text-text-secondary">
                <span className="font-medium text-text-primary">{e.actor}</span> {e.action}
                <span className="ml-1.5 text-[10px] text-text-muted">{e.occurred_at}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskDiffPane({ diff, repo }: { diff: TaskDiff | undefined; repo: string | undefined }) {
  if (!repo) {
    return <div className="text-xs text-text-muted">No repo associated with this task.</div>;
  }
  if (!diff) {
    return <div className="text-xs text-text-muted">Loading…</div>;
  }
  if (diff.files.length === 0) {
    return <div className="text-xs text-text-muted">No changes yet.</div>;
  }
  return (
    <div className="flex flex-col gap-3 text-xs">
      {diff.truncated && (
        <div className="rounded bg-surface-secondary px-2 py-1 text-[11px] text-text-muted">
          Diff truncated — showing a partial view.
        </div>
      )}
      <div className="flex flex-col gap-1">
        {diff.files.map((f) => (
          <div key={f.filename} className="flex items-center gap-2 font-mono">
            <span className="min-w-0 flex-1 truncate text-text-primary">{f.filename}</span>
            <span className="shrink-0 text-success">+{f.additions}</span>
            <span className="shrink-0 text-danger">-{f.deletions}</span>
          </div>
        ))}
      </div>
      {diff.unified_diff && (
        <pre className="max-h-96 overflow-auto rounded bg-surface-secondary p-2 font-mono text-[11px] leading-relaxed text-text-secondary">
          {diff.unified_diff}
        </pre>
      )}
    </div>
  );
}

function TaskDetailTab({
  index,
  detail,
  diff,
  subTab,
  onSelectSubTab,
}: {
  index: number;
  detail: TaskDetail | undefined;
  diff: TaskDiff | undefined;
  subTab: 'spec' | 'diff';
  onSelectSubTab: (tab: 'spec' | 'diff') => void;
}) {
  if (!detail) {
    return <div className="p-4 text-xs text-text-muted">Loading…</div>;
  }
  const meta = taskStatusMeta(detail.status);
  const isHuman = detail.execution?.actor_type === 'human';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
            T{index}
          </span>
          <span className="rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
            {isHuman ? 'Human' : 'Agent'}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ color: meta.color, background: tint(meta.color) }}
          >
            {meta.label}
          </span>
        </div>
        <h2 className="mt-1.5 truncate text-sm font-semibold text-text-primary">
          {detail.title || detail.task_name}
        </h2>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
          {detail.repo && (
            <div>
              <span className="text-text-muted">Repo </span>
              <span className="font-mono text-text-secondary">{detail.repo}</span>
            </div>
          )}
          {detail.branch && (
            <div>
              <span className="text-text-muted">Branch </span>
              <span className="font-mono text-text-secondary">{detail.branch}</span>
            </div>
          )}
          <div>
            <span className="text-text-muted">Model </span>
            <span className="text-text-secondary">{detail.model_id || 'Not assigned'}</span>
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border px-2 pt-1">
        {(['spec', 'diff'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelectSubTab(s)}
            className={
              'shrink-0 rounded-t px-3 py-1.5 text-xs font-medium ' +
              (subTab === s
                ? 'border-b-2 border-accent text-text-primary'
                : 'text-text-muted hover:text-text-primary')
            }
          >
            {s === 'spec' ? 'Spec' : 'Diff'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {subTab === 'spec' ? (
          <TaskSpecPane detail={detail} />
        ) : (
          <TaskDiffPane diff={diff} repo={detail.repo} />
        )}
      </div>
    </div>
  );
}

function prNumber(url: string | null): string {
  if (!url) return '—';
  const m = url.match(/\/(\d+)\/?$/);
  return m ? `#${m[1]}` : url;
}

const PILL_COLORS: Record<string, string> = {
  open: 'var(--color-primary)',
  merged: 'var(--color-purple)',
  closed: 'var(--color-text-muted)',
  resolved: 'var(--color-success)',
  conflicting: 'var(--color-danger)',
  none: 'var(--color-text-muted)',
};

function pillColor(value: string): string {
  return PILL_COLORS[value.toLowerCase()] ?? 'var(--color-text-secondary)';
}

function Pill({ value }: { value: string }) {
  const color = pillColor(value);
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
      style={{ color, background: tint(color) }}
    >
      {value}
    </span>
  );
}

function HandoffRow({ pr }: { pr: HandoffPR }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="py-1.5 pr-3 font-mono text-text-secondary">{pr.repo}</td>
      <td className="py-1.5 pr-3">
        {pr.pr_url ? (
          <button
            type="button"
            onClick={() => vscode.postMessage({ command: 'openExternalUrl', url: pr.pr_url })}
            className="flex items-center gap-1 text-accent hover:underline"
          >
            {prNumber(pr.pr_url)}
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
          </button>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="py-1.5 pr-3">
        <Pill value={pr.status} />
      </td>
      <td className="py-1.5">
        {pr.conflict_state ? (
          <Pill value={pr.conflict_state} />
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
    </tr>
  );
}

function HandoffView({ handoff }: { handoff: FeatureHandoff | null }) {
  if (!handoff) {
    return <div className="text-xs text-text-muted">No handoff yet.</div>;
  }
  return (
    <div>
      <div className="mb-3 text-[11px] text-text-muted">
        Created: {new Date(handoff.created_at).toLocaleString()}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-text-muted">
            <th className="pb-1.5 pr-3 font-medium">Repo</th>
            <th className="pb-1.5 pr-3 font-medium">PR</th>
            <th className="pb-1.5 pr-3 font-medium">Status</th>
            <th className="pb-1.5 font-medium">Conflict State</th>
          </tr>
        </thead>
        <tbody>
          {handoff.prs.map((pr) => (
            <HandoffRow key={pr.repo} pr={pr} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Feature-detail editor tab — Product Spec/Tech Design/Tasks/Handoff/Activity,
 * mirroring digital-factory-ui's own feature detail page. Rendered when this
 * webview was opened as a FeatureDetailPanel (see panel-context.ts), as
 * opposed to the sidebar Navigator. Clicking a task in the Tasks tab opens an
 * additional in-panel tab (mirroring Claude Code's own T1/T2 task-tab
 * pattern) with a Spec/Diff sub-tab pair, fetched on demand.
 */
export function FeatureDetail() {
  const feature = getInitialFeature();
  const [tab, setTab] = useState<TabKey>('product_spec');
  const [state, setState] = useState<DetailState>({
    docs: {},
    tasks: [],
    handoff: null,
    activity: [],
    loaded: false,
  });
  const [openTaskIds, setOpenTaskIds] = useState<string[]>([]);
  const [taskDetails, setTaskDetails] = useState<Record<string, TaskDetail | undefined>>({});
  const [taskDiffs, setTaskDiffs] = useState<Record<string, TaskDiff | undefined>>({});
  const [taskSubTab, setTaskSubTab] = useState<Record<string, 'spec' | 'diff'>>({});

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.command === 'featureDetailLoaded') {
        setState({
          docs: msg.docs || {},
          tasks: msg.tasks || [],
          handoff: msg.handoff ?? null,
          activity: msg.activity || [],
          loaded: true,
        });
      } else if (msg?.command === 'taskDetailLoaded') {
        setTaskDetails((prev) => ({ ...prev, [msg.taskId]: msg.detail ?? undefined }));
      } else if (msg?.command === 'taskDiffLoaded') {
        setTaskDiffs((prev) => ({ ...prev, [msg.taskId]: msg.diff ?? undefined }));
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ command: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const openTask = useCallback(
    (task: TaskSummary) => {
      setOpenTaskIds((prev) => (prev.includes(task.id) ? prev : [...prev, task.id]));
      setTaskSubTab((prev) => (prev[task.id] ? prev : { ...prev, [task.id]: 'spec' }));
      setTab(`task:${task.id}`);
      setTaskDetails((prev) => {
        if (prev[task.id] !== undefined) return prev;
        vscode.postMessage({ command: 'openTask', taskId: task.id });
        return prev;
      });
    },
    [setTab],
  );

  const closeTask = useCallback(
    (taskId: string, ev: MouseEvent) => {
      ev.stopPropagation();
      setOpenTaskIds((prev) => prev.filter((id) => id !== taskId));
      setTab((prev) => (prev === `task:${taskId}` ? 'tasks' : prev));
    },
    [setTab],
  );

  const selectTaskSubTab = useCallback(
    (taskId: string, sub: 'spec' | 'diff') => {
      setTaskSubTab((prev) => ({ ...prev, [taskId]: sub }));
      if (sub === 'diff') {
        setTaskDiffs((prev) => {
          if (prev[taskId] !== undefined) return prev;
          const detail = taskDetails[taskId];
          if (detail?.repo) {
            vscode.postMessage({ command: 'loadTaskDiff', taskId, repo: detail.repo });
          }
          return prev;
        });
      }
    },
    [taskDetails],
  );

  if (!feature) {
    return <div className="p-4 text-xs text-text-muted">No feature data.</div>;
  }

  const meta = lifecycleMeta(feature.status);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: meta.color, background: tint(meta.color) }}
        >
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
          {feature.feature_name || feature.title || feature.id}
        </span>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-1">
        {BASE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              'shrink-0 rounded-t px-3 py-1.5 text-xs font-medium ' +
              (tab === t.key
                ? 'border-b-2 border-accent text-text-primary'
                : 'text-text-muted hover:text-text-primary')
            }
          >
            {t.label}
            {t.key === 'activity' && state.activity.length > 0 && (
              <span className="ml-1.5 text-text-muted">{state.activity.length}</span>
            )}
            {t.key === 'tasks' && state.tasks.length > 0 && (
              <span className="ml-1.5 text-text-muted">{state.tasks.length}</span>
            )}
          </button>
        ))}
        {openTaskIds.map((taskId) => {
          const index = state.tasks.findIndex((t) => t.id === taskId) + 1;
          const key: TabKey = `task:${taskId}`;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                'flex shrink-0 items-center gap-1.5 rounded-t px-3 py-1.5 text-xs font-medium ' +
                (tab === key
                  ? 'border-b-2 border-accent text-text-primary'
                  : 'text-text-muted hover:text-text-primary')
              }
            >
              T{index > 0 ? index : '?'}
              <span
                role="button"
                tabIndex={0}
                onClick={(ev) => closeTask(taskId, ev)}
                className="rounded p-0.5 hover:bg-surface-secondary"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>

      {tab.startsWith('task:') ? (
        (() => {
          const taskId = tab.slice('task:'.length);
          const index = state.tasks.findIndex((t) => t.id === taskId) + 1;
          return (
            <div className="flex flex-1 flex-col overflow-hidden">
              <TaskDetailTab
                index={index > 0 ? index : 0}
                detail={taskDetails[taskId]}
                diff={taskDiffs[taskId]}
                subTab={taskSubTab[taskId] ?? 'spec'}
                onSelectSubTab={(sub) => selectTaskSubTab(taskId, sub)}
              />
            </div>
          );
        })()
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!state.loaded ? (
            <div className="text-xs text-text-muted">Loading…</div>
          ) : tab === 'activity' ? (
            <ActivityTimeline events={state.activity} tasks={state.tasks} />
          ) : tab === 'tasks' ? (
            <TaskList tasks={state.tasks} onOpen={openTask} />
          ) : tab === 'handoff' ? (
            <HandoffView handoff={state.handoff} />
          ) : (
            <MarkdownDoc content={state.docs[tab]} />
          )}
        </div>
      )}
    </div>
  );
}
