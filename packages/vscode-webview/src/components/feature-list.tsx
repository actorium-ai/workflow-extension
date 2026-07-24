import { useState } from 'react';

import { lifecycleMeta, statusSortIndex, tint } from '../utils/feature-meta.ts';
import type { FeatureSummary, TaskSummary } from '../utils/types.ts';
import { LifecycleGlyph, TaskStatusGlyph } from './status-glyph.tsx';

interface FeatureListProps {
  features: FeatureSummary[];
  taskCache: Record<string, TaskSummary[] | undefined>;
  onRequestTasks: (featureId: string) => void;
  onInsertMention: (token: string) => void;
}

function TaskRow({ task }: { task: TaskSummary }) {
  const done =
    task.status === 'done' || task.status === 'cancelled' || task.status === 'review_passed';
  return (
    <div className="flex items-center gap-2 py-1 pr-2 pl-9 text-left">
      <TaskStatusGlyph status={task.status} size={10} />
      <span
        className={
          'min-w-0 flex-1 truncate text-[11.5px]' +
          (done ? ' text-text-muted' : ' text-text-primary')
        }
      >
        {task.title}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-text-muted">{task.task_name}</span>
    </div>
  );
}

function FeatureRow({
  feature,
  tasks,
  onRequestTasks,
  onInsertMention,
}: {
  feature: FeatureSummary;
  tasks: TaskSummary[] | undefined;
  onRequestTasks: (featureId: string) => void;
  onInsertMention: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasTasks = !!feature.task_counts && feature.task_counts.total > 0;

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', `<ft:${feature.feature_name || feature.id}>`);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-surface-secondary"
      >
        <button
          type="button"
          disabled={!hasTasks}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next && tasks === undefined) onRequestTasks(feature.id);
          }}
          aria-label={open ? 'Collapse tasks' : 'Expand tasks'}
          className={'shrink-0 text-text-muted' + (hasTasks ? '' : ' opacity-0')}
        >
          <span
            className={'inline-block transition-transform' + (open ? ' rotate-90' : '')}
            aria-hidden="true"
          >
            ›
          </span>
        </button>
        <LifecycleGlyph stage={feature.status} />
        <button
          type="button"
          title={feature.next_action || feature.current_stage}
          onClick={() => onInsertMention(`<ft:${feature.feature_name || feature.id}>`)}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium text-text-primary"
        >
          {feature.feature_name || feature.title || feature.id}
        </button>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{
            color: lifecycleMeta(feature.status).color,
            background: tint(lifecycleMeta(feature.status).color),
          }}
        >
          {lifecycleMeta(feature.status).label}
        </span>
      </div>
      {open && (tasks ?? []).map((t) => <TaskRow key={t.id} task={t} />)}
    </div>
  );
}

export function FeatureList({
  features,
  taskCache,
  onRequestTasks,
  onInsertMention,
}: FeatureListProps) {
  if (features.length === 0) {
    return <div className="px-3 py-3 text-center text-xs text-text-muted">No features yet.</div>;
  }

  const groups = new Map<string, FeatureSummary[]>();
  for (const f of features) {
    const list = groups.get(f.status) ?? [];
    list.push(f);
    groups.set(f.status, list);
  }
  const orderedGroups = Array.from(groups.entries()).sort(
    ([a], [b]) => statusSortIndex(a) - statusSortIndex(b),
  );

  return (
    <div className="px-1">
      {orderedGroups.map(([status, groupFeatures]) => {
        const meta = lifecycleMeta(status);
        return (
          <div key={status} className="mt-2 first:mt-0">
            <div className="flex items-center gap-2 px-2 py-1">
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ color: meta.color, background: tint(meta.color) }}
              >
                {meta.label}
              </span>
              <span className="text-[10px] text-text-muted">
                {groupFeatures.length} {groupFeatures.length === 1 ? 'feature' : 'features'}
              </span>
            </div>
            {groupFeatures.map((f) => (
              <FeatureRow
                key={f.id}
                feature={f}
                tasks={taskCache[f.id]}
                onRequestTasks={onRequestTasks}
                onInsertMention={onInsertMention}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
