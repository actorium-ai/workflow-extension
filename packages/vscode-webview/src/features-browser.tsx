import {
  ChevronDown,
  ChevronRight,
  GitPullRequestArrow,
  LayoutGrid,
  List,
  Loader2,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { LifecycleGlyph, StatusPill, TaskStatusGlyph } from './components/status-glyph.tsx';
import { lifecycleMeta, STATUS_ORDER, tint } from './utils/feature-meta.ts';
import type { FeatureSummary, TaskSummary } from './utils/types.ts';
import { getVsCodeApi } from './utils/vscode-api.ts';

const vscode = getVsCodeApi();

type ViewMode = 'list' | 'grid';

/** Quick filters differ by view, matching digital-factory-ui's board-view.tsx
 * (LIST_FILTERS/KANBAN_FILTERS): List mode filters by whether a feature has
 * any task in a given status; Grid (kanban) mode filters by the feature's
 * own lifecycle stage — these are different axes, not the same filter
 * re-labeled, so switching view resets whichever set was active. */
const LIST_FILTERS: { key: string; label: string; glyphStatus: string; color: string }[] = [
  { key: 'ready', label: 'Ready', glyphStatus: 'ready', color: 'var(--color-text-muted)' },
  {
    key: 'in_progress',
    label: 'In Progress',
    glyphStatus: 'in_progress',
    color: 'var(--color-primary)',
  },
  { key: 'blocked', label: 'Blocked', glyphStatus: 'blocked', color: 'var(--color-danger)' },
];

const GRID_FILTERS: { key: string; stage: string }[] = [
  { key: 'ready_for_implementation', stage: 'ready_for_implementation' },
  { key: 'in_implementation', stage: 'in_implementation' },
  { key: 'in_handoff', stage: 'in_handoff' },
];

function matchesQuery(feature: FeatureSummary, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (feature.feature_name || '').toLowerCase().includes(q) ||
    (feature.title || '').toLowerCase().includes(q)
  );
}

/** List mode: does this feature have any task in one of the checked
 * statuses? "Ready" covers both 'ready' and 'todo' task counts, matching
 * digital-factory-ui's LIST_FILTERS (taskStatuses: ["ready", "todo"]). */
function matchesListChips(feature: FeatureSummary, chips: Set<string>): boolean {
  if (chips.size === 0) return true;
  const counts = feature.task_counts;
  if (chips.has('ready') && (counts?.ready ?? 0) + (counts?.todo ?? 0) > 0) return true;
  if (chips.has('in_progress') && (counts?.in_progress ?? 0) > 0) return true;
  if (chips.has('blocked') && (counts?.blocked ?? 0) > 0) return true;
  return false;
}

/** Grid mode: is this feature currently in one of the checked lifecycle
 * stages? */
function matchesGridChips(feature: FeatureSummary, chips: Set<string>): boolean {
  if (chips.size === 0) return true;
  return chips.has(feature.status);
}

/** Every feature grouped by lifecycle status, in the SAME fixed canonical
 * order and full 8-status set as digital-factory-ui's own Features page —
 * including statuses with zero matching features, so a currently-empty
 * stage (e.g. "Ready for Impl.") still renders its own empty column/section
 * instead of silently disappearing. */
function groupByStatus(features: FeatureSummary[]): [string, FeatureSummary[]][] {
  const byStatus = new Map<string, FeatureSummary[]>();
  for (const status of STATUS_ORDER) byStatus.set(status, []);
  for (const f of features) {
    const list = byStatus.get(f.status) ?? [];
    list.push(f);
    byStatus.set(f.status, list);
  }
  return Array.from(byStatus.entries());
}

/** Green fill at 100%, matching digital-factory-ui's feature-list-view.tsx
 * (a completed feature's bar reads as "done", not just "full of its own
 * accent color"). */
function ProgressBar({ counts }: { counts: FeatureSummary['task_counts'] }) {
  const total = counts?.total ?? 0;
  const done = counts?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex w-24 shrink-0 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-secondary">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: pct === 100 ? 'var(--color-success)' : 'var(--color-accent)',
          }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] text-text-muted">{pct}%</span>
    </div>
  );
}

function FilterChips({
  mode,
  active,
  onToggle,
}: {
  mode: ViewMode;
  active: Set<string>;
  onToggle: (chip: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {mode === 'list'
        ? LIST_FILTERS.map((f) => {
            const isActive = active.has(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => onToggle(f.key)}
                className={
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ' +
                  (isActive ? '' : 'border-border text-text-secondary hover:bg-surface-secondary')
                }
                style={
                  isActive
                    ? { borderColor: f.color, background: tint(f.color), color: f.color }
                    : undefined
                }
              >
                <TaskStatusGlyph status={f.glyphStatus} size={11} />
                {f.label}
              </button>
            );
          })
        : GRID_FILTERS.map((f) => {
            const meta = lifecycleMeta(f.stage);
            const isActive = active.has(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => onToggle(f.key)}
                className={
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ' +
                  (isActive ? '' : 'border-border text-text-secondary hover:bg-surface-secondary')
                }
                style={
                  isActive
                    ? { borderColor: meta.color, background: tint(meta.color), color: meta.color }
                    : undefined
                }
              >
                <LifecycleGlyph stage={f.stage} size={11} />
                {meta.label}
              </button>
            );
          })}
    </div>
  );
}

function TaskRow({ task, index }: { task: TaskSummary; index: number }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 pl-9 pr-3 text-xs">
      <TaskStatusGlyph status={task.status} size={13} />
      <span className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
        T{index}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-secondary">
        {task.title || task.task_name}
      </span>
      <StatusPill status={task.status} />
    </div>
  );
}

function FeatureListRow({
  feature,
  tasks,
  onOpen,
  onCheckoutHandoffPRs,
  checkingOutFeatures,
}: {
  feature: FeatureSummary;
  tasks: TaskSummary[];
  onOpen: (feature: FeatureSummary) => void;
  onCheckoutHandoffPRs: (feature: FeatureSummary) => void;
  checkingOutFeatures: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const checkingOut = checkingOutFeatures.has(feature.id);
  const meta = lifecycleMeta(feature.status);
  return (
    <div className="group border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-secondary">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          disabled={tasks.length === 0}
          className="shrink-0 rounded p-0.5 text-text-muted disabled:opacity-30"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onOpen(feature)}
          title="Open feature"
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
        >
          <LifecycleGlyph stage={feature.status} />
          <span className="min-w-0 flex-1 truncate font-semibold text-text-primary">
            {feature.feature_name || feature.title || feature.id}
          </span>
        </button>
        {feature.status === 'in_handoff' && (
          <button
            type="button"
            title="Checkout PR for review"
            disabled={checkingOut}
            onClick={() => onCheckoutHandoffPRs(feature)}
            className={`shrink-0 rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-text-primary disabled:pointer-events-none ${checkingOut ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            {checkingOut ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <GitPullRequestArrow className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
          </button>
        )}
        <span
          className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: meta.color, background: tint(meta.color) }}
        >
          {meta.label}
        </span>
        <div className="w-24 shrink-0">
          <ProgressBar counts={feature.task_counts} />
        </div>
      </div>
      {expanded && (
        <div className="pb-1">
          {tasks.map((t, i) => (
            <TaskRow key={t.id} task={t} index={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeatureStatusSection({
  status,
  features,
  tasksByFeatureId,
  onOpen,
  onCheckoutHandoffPRs,
  checkingOutFeatures,
}: {
  status: string;
  features: FeatureSummary[];
  tasksByFeatureId: Map<string, TaskSummary[]>;
  onOpen: (feature: FeatureSummary) => void;
  onCheckoutHandoffPRs: (feature: FeatureSummary) => void;
  checkingOutFeatures: Set<string>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const meta = lifecycleMeta(status);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-secondary"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
        )}
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: meta.color, background: tint(meta.color) }}
        >
          {meta.label}
        </span>
        <span className="text-[11px] text-text-muted">
          {features.length} {features.length === 1 ? 'feature' : 'features'}
        </span>
      </button>
      {!collapsed &&
        (features.length === 0 ? (
          <div className="px-9 py-2 text-xs text-text-muted">No features.</div>
        ) : (
          features.map((f) => (
            <FeatureListRow
              key={f.id}
              feature={f}
              tasks={tasksByFeatureId.get(f.id) ?? []}
              onOpen={onOpen}
              onCheckoutHandoffPRs={onCheckoutHandoffPRs}
              checkingOutFeatures={checkingOutFeatures}
            />
          ))
        ))}
    </div>
  );
}

function FeatureListView({
  features,
  tasksByFeatureId,
  onOpen,
  onCheckoutHandoffPRs,
  checkingOutFeatures,
}: {
  features: FeatureSummary[];
  tasksByFeatureId: Map<string, TaskSummary[]>;
  onOpen: (feature: FeatureSummary) => void;
  onCheckoutHandoffPRs: (feature: FeatureSummary) => void;
  checkingOutFeatures: Set<string>;
}) {
  const groups = useMemo(() => groupByStatus(features), [features]);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-3 pb-2 text-[10px] uppercase tracking-wide text-text-muted">
        <span className="w-3.5 shrink-0" />
        <span className="flex-1">Feature</span>
        <span className="w-20 shrink-0">Stage</span>
        <span className="w-24 shrink-0">Progress</span>
      </div>
      {groups.map(([status, groupFeatures]) => (
        <FeatureStatusSection
          key={status}
          status={status}
          features={groupFeatures}
          tasksByFeatureId={tasksByFeatureId}
          onOpen={onOpen}
          onCheckoutHandoffPRs={onCheckoutHandoffPRs}
          checkingOutFeatures={checkingOutFeatures}
        />
      ))}
    </div>
  );
}

function FeatureCard({
  feature,
  onOpen,
  onCheckoutHandoffPRs,
  checkingOutFeatures,
}: {
  feature: FeatureSummary;
  onOpen: (feature: FeatureSummary) => void;
  onCheckoutHandoffPRs: (feature: FeatureSummary) => void;
  checkingOutFeatures: Set<string>;
}) {
  const meta = lifecycleMeta(feature.status);
  const checkingOut = checkingOutFeatures.has(feature.id);
  return (
    <div className="group relative">
      <button
        type="button"
        title={feature.next_action || feature.current_stage}
        onClick={() => onOpen(feature)}
        className="flex w-full flex-col rounded-md border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-secondary"
      >
        {/* digital-factory-ui's kanban card shows a short mono id above the
            title, since its own `id` is a human-readable slug from YAML — this
            app's FeatureSummary.id is a raw backend UUID instead, so showing it
            here would just be meaningless noise; the name is the only useful
            identity we have, shown once. */}
        <div className="mb-2.5 flex items-center gap-1.5">
          <LifecycleGlyph stage={feature.status} size={12} />
          <p className="min-w-0 flex-1 truncate text-xs font-medium leading-snug text-text-primary">
            {feature.feature_name || feature.title || feature.id}
          </p>
        </div>
        <span
          className="w-fit shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: meta.color, background: tint(meta.color) }}
        >
          {meta.label}
        </span>
      </button>
      {feature.status === 'in_handoff' && (
        <button
          type="button"
          title="Checkout PR for review"
          disabled={checkingOut}
          onClick={() => onCheckoutHandoffPRs(feature)}
          className={`absolute right-1.5 top-1.5 rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-text-primary disabled:pointer-events-none ${checkingOut ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          {checkingOut ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <GitPullRequestArrow className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}

function FeatureGridView({
  features,
  onOpen,
  onCheckoutHandoffPRs,
  checkingOutFeatures,
}: {
  features: FeatureSummary[];
  onOpen: (feature: FeatureSummary) => void;
  onCheckoutHandoffPRs: (feature: FeatureSummary) => void;
  checkingOutFeatures: Set<string>;
}) {
  const columns = useMemo(() => groupByStatus(features), [features]);

  return (
    <div className="flex h-full gap-3 overflow-x-auto">
      {columns.map(([status, groupFeatures]) => {
        const meta = lifecycleMeta(status);
        return (
          <div key={status} className="flex w-64 shrink-0 flex-col gap-2">
            <div className="flex items-center gap-2 px-1">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ color: meta.color, background: tint(meta.color) }}
              >
                {meta.label}
              </span>
              <span className="text-[10px] text-text-muted">{groupFeatures.length}</span>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto">
              {groupFeatures.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-text-muted">
                  No features
                </div>
              ) : (
                groupFeatures.map((f) => (
                  <FeatureCard
                    key={f.id}
                    feature={f}
                    onOpen={onOpen}
                    onCheckoutHandoffPRs={onCheckoutHandoffPRs}
                    checkingOutFeatures={checkingOutFeatures}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Full-workspace Features browser — an editor tab listing every feature,
 * with search, Ready/In Progress/Blocked filter chips, and a list/grid
 * (kanban) view toggle. Opened via the sidebar Features section's "Open all"
 * action (see FeaturesBrowserPanel). Mirrors digital-factory-ui's own
 * Features page — read-only, like the rest of this extension, so there's no
 * "New Feature" action here. Both views always show all 8 canonical
 * lifecycle stages (even ones with no current features), matching
 * digital-factory-ui's board; the List view's per-feature rows expand to
 * reveal that feature's tasks (T1/T2/…), sourced from the same
 * workspace-detail fetch (no extra request).
 */
export function FeaturesBrowser() {
  const [features, setFeatures] = useState<FeatureSummary[] | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [query, setQuery] = useState('');
  const [activeChips, setActiveChips] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewMode>('list');
  const [checkingOutFeatures, setCheckingOutFeatures] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.command === 'featuresLoaded') {
        setFeatures(event.data.features || []);
        setTasks(event.data.tasks || []);
      } else if (event.data?.command === 'checkoutHandoffPRsDone') {
        setCheckingOutFeatures((prev) => {
          const next = new Set(prev);
          next.delete(event.data.featureId);
          return next;
        });
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ command: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const openFeatureDetail = (feature: FeatureSummary) =>
    vscode.postMessage({ command: 'openFeatureDetail', feature });

  // The extension host confirms (naming every repo/PR involved) before
  // touching anything — see handoffCheckout.ts.
  const checkoutHandoffPRs = (feature: FeatureSummary) => {
    setCheckingOutFeatures((prev) => new Set(prev).add(feature.id));
    vscode.postMessage({ command: 'checkoutHandoffPRs', feature });
  };

  /** Switching view resets quick filters — the two filter sets are different
   * axes (task status vs lifecycle stage), so carrying one over as if it
   * still applied to the other view would silently misfilter it. */
  const changeView = (next: ViewMode) => {
    setView(next);
    setActiveChips(new Set());
  };

  const toggleChip = (chip: string) =>
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });

  const filtered = useMemo(
    () =>
      (features ?? [])
        .filter((f) => matchesQuery(f, query))
        .filter((f) =>
          view === 'list' ? matchesListChips(f, activeChips) : matchesGridChips(f, activeChips),
        ),
    [features, query, activeChips, view],
  );

  const tasksByFeatureId = useMemo(() => {
    const m = new Map<string, TaskSummary[]>();
    for (const t of tasks) {
      const list = m.get(t.feature_id) ?? [];
      list.push(t);
      m.set(t.feature_id, list);
    }
    return m;
  }, [tasks]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-text-primary">Features</span>
        <FilterChips mode={view} active={activeChips} onToggle={toggleChip} />
        <div className="ml-auto flex items-center gap-2">
          <div className="flex min-w-0 max-w-xs flex-1 items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search features…"
              className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
            <button
              type="button"
              title="List view"
              onClick={() => changeView('list')}
              className={
                'p-1.5 ' +
                (view === 'list'
                  ? 'bg-surface-secondary text-text-primary'
                  : 'text-text-muted hover:text-text-primary')
              }
            >
              <List className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              title="Grid view"
              onClick={() => changeView('grid')}
              className={
                'p-1.5 ' +
                (view === 'grid'
                  ? 'bg-surface-secondary text-text-primary'
                  : 'text-text-muted hover:text-text-primary')
              }
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {features === null ? (
          <div className="px-2 py-3 text-center text-xs text-text-muted">Loading…</div>
        ) : view === 'list' ? (
          <FeatureListView
            features={filtered}
            tasksByFeatureId={tasksByFeatureId}
            onOpen={openFeatureDetail}
            onCheckoutHandoffPRs={checkoutHandoffPRs}
            checkingOutFeatures={checkingOutFeatures}
          />
        ) : (
          <FeatureGridView
            features={filtered}
            onOpen={openFeatureDetail}
            onCheckoutHandoffPRs={checkoutHandoffPRs}
            checkingOutFeatures={checkingOutFeatures}
          />
        )}
      </div>
    </div>
  );
}
