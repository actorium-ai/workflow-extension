import { ChevronDown, ChevronRight, LayoutGrid, List, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { LifecycleGlyph, TaskStatusGlyph } from './components/status-glyph.tsx';
import { lifecycleMeta, STATUS_ORDER, taskStatusMeta, tint } from './utils/feature-meta.ts';
import type { FeatureSummary, TaskSummary } from './utils/types.ts';
import { getVsCodeApi } from './utils/vscode-api.ts';

const vscode = getVsCodeApi();

type ViewMode = 'list' | 'grid';

type FilterChip = 'ready' | 'in_progress' | 'blocked';

const FILTER_CHIPS: { key: FilterChip; label: string }[] = [
  { key: 'ready', label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
];

function matchesQuery(feature: FeatureSummary, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (feature.feature_name || '').toLowerCase().includes(q) ||
    (feature.title || '').toLowerCase().includes(q)
  );
}

function matchesChips(feature: FeatureSummary, chips: Set<FilterChip>): boolean {
  if (chips.size === 0) return true;
  const counts = feature.task_counts;
  return Array.from(chips).some((chip) => (counts?.[chip] ?? 0) > 0);
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

function ProgressBar({ counts }: { counts: FeatureSummary['task_counts'] }) {
  const total = counts?.total ?? 0;
  const done = counts?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex w-24 shrink-0 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-secondary">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] text-text-muted">{pct}%</span>
    </div>
  );
}

/** No per-feature/per-task assignee data exists on FeatureSummary/TaskSummary
 * today — this is a placeholder slot (mirroring digital-factory-ui's
 * ASSIGNEES column) rather than fabricated names, so it reads as "not
 * tracked here" instead of silently showing wrong people. */
function AssigneesCell() {
  return (
    <span className="flex items-center gap-1 text-text-muted" title="No assignee data available">
      <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="text-[11px]">—</span>
    </span>
  );
}

function FilterChips({
  active,
  onToggle,
}: {
  active: Set<FilterChip>;
  onToggle: (chip: FilterChip) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {FILTER_CHIPS.map((chip) => {
        const isActive = active.has(chip.key);
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onToggle(chip.key)}
            className={
              'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ' +
              (isActive
                ? 'border-accent bg-accent text-primary-foreground'
                : 'border-border text-text-secondary hover:bg-surface-secondary')
            }
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

function TaskRow({ task, index }: { task: TaskSummary; index: number }) {
  const meta = taskStatusMeta(task.status);
  return (
    <div className="flex items-center gap-2.5 py-1.5 pl-9 pr-3 text-xs">
      <TaskStatusGlyph status={task.status} size={13} />
      <span className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
        T{index}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-secondary">
        {task.title || task.task_name}
      </span>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{ color: meta.color, background: tint(meta.color) }}
      >
        {meta.label}
      </span>
      <span className="w-12 shrink-0" />
    </div>
  );
}

function FeatureListRow({
  feature,
  tasks,
  onOpen,
}: {
  feature: FeatureSummary;
  tasks: TaskSummary[];
  onOpen: (feature: FeatureSummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-border last:border-b-0">
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
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
        >
          <LifecycleGlyph stage={feature.status} />
          <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
            {feature.feature_name || feature.title || feature.id}
          </span>
        </button>
        <div className="w-24 shrink-0">
          <ProgressBar counts={feature.task_counts} />
        </div>
        <div className="w-16 shrink-0">
          <AssigneesCell />
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
}: {
  status: string;
  features: FeatureSummary[];
  tasksByFeatureId: Map<string, TaskSummary[]>;
  onOpen: (feature: FeatureSummary) => void;
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
}: {
  features: FeatureSummary[];
  tasksByFeatureId: Map<string, TaskSummary[]>;
  onOpen: (feature: FeatureSummary) => void;
}) {
  const groups = useMemo(() => groupByStatus(features), [features]);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-3 pb-2 text-[10px] uppercase tracking-wide text-text-muted">
        <span className="w-3.5 shrink-0" />
        <span className="flex-1">Feature</span>
        <span className="w-24 shrink-0">Progress</span>
        <span className="w-16 shrink-0">Assignees</span>
      </div>
      {groups.map(([status, groupFeatures]) => (
        <FeatureStatusSection
          key={status}
          status={status}
          features={groupFeatures}
          tasksByFeatureId={tasksByFeatureId}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function FeatureCard({
  feature,
  onOpen,
}: {
  feature: FeatureSummary;
  onOpen: (feature: FeatureSummary) => void;
}) {
  return (
    <button
      type="button"
      title={feature.next_action || feature.current_stage}
      onClick={() => onOpen(feature)}
      className="flex w-full flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-secondary"
    >
      <span className="min-w-0 truncate text-xs font-medium text-text-primary">
        {feature.feature_name || feature.title || feature.id}
      </span>
      <ProgressBar counts={feature.task_counts} />
      <AssigneesCell />
    </button>
  );
}

function FeatureGridView({
  features,
  onOpen,
}: {
  features: FeatureSummary[];
  onOpen: (feature: FeatureSummary) => void;
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
                groupFeatures.map((f) => <FeatureCard key={f.id} feature={f} onOpen={onOpen} />)
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
  const [activeChips, setActiveChips] = useState<Set<FilterChip>>(new Set());
  const [view, setView] = useState<ViewMode>('list');

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.command === 'featuresLoaded') {
        setFeatures(event.data.features || []);
        setTasks(event.data.tasks || []);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ command: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const openFeatureDetail = (feature: FeatureSummary) =>
    vscode.postMessage({ command: 'openFeatureDetail', feature });

  const toggleChip = (chip: FilterChip) =>
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
        .filter((f) => matchesChips(f, activeChips)),
    [features, query, activeChips],
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
        <FilterChips active={activeChips} onToggle={toggleChip} />
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
              onClick={() => setView('list')}
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
              onClick={() => setView('grid')}
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
          />
        ) : (
          <FeatureGridView features={filtered} onOpen={openFeatureDetail} />
        )}
      </div>
    </div>
  );
}
