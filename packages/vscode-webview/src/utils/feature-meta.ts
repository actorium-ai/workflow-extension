/** Trimmed port of digital-factory-ui's board-meta.ts FEATURE_LIFECYCLE_META —
 * same status keys/labels/ordering, expressed with our vscode-token palette
 * (--color-success/--color-warning/--color-purple, see styles.css) instead
 * of digital-factory-ui's fixed oklch brand colors. */
export function tint(cssVar: string, percent = 15): string {
  return `color-mix(in oklch, ${cssVar} ${percent}%, transparent)`;
}

export const FEATURE_LIFECYCLE_META: Record<string, { label: string; color: string }> = {
  backlog: { label: 'Backlog', color: 'var(--color-text-muted)' },
  in_design: { label: 'In Design', color: 'var(--color-warning)' },
  in_tdd: { label: 'In TDD', color: 'var(--color-purple)' },
  ready_for_implementation: { label: 'Ready for Impl.', color: 'var(--color-warning)' },
  in_implementation: { label: 'In Implementation', color: 'var(--color-primary)' },
  preparing_handoff: { label: 'Preparing Handoff', color: 'var(--color-preparing)' },
  handoff_blocked: { label: 'Handoff Blocked', color: 'var(--color-danger)' },
  in_handoff: { label: 'In Handoff', color: 'var(--color-warning)' },
  in_finalization: { label: 'Finalizing', color: 'var(--color-finalizing)' },
  finalization_blocked: { label: 'Finalization Blocked', color: 'var(--color-danger)' },
  done: { label: 'Done', color: 'var(--color-success)' },
  blocked: { label: 'Blocked', color: 'var(--color-danger)' },
  cancelled: { label: 'Cancelled', color: 'var(--color-text-muted)' },
};

export function lifecycleMeta(status: string) {
  return FEATURE_LIFECYCLE_META[status] ?? { label: status, color: 'var(--color-text-muted)' };
}

/** Same grouping order as digital-factory-ui's feature-list-view.tsx
 * STATUS_ORDER — in-flight statuses first, done/cancelled last. */
export const STATUS_ORDER = [
  'backlog',
  'blocked',
  'finalization_blocked',
  'in_finalization',
  'in_handoff',
  'handoff_blocked',
  'preparing_handoff',
  'in_implementation',
  'ready_for_implementation',
  'in_tdd',
  'in_design',
  'done',
  'cancelled',
];

export function statusSortIndex(status: string): number {
  const i = STATUS_ORDER.indexOf(status);
  return i === -1 ? STATUS_ORDER.length - 2 : i;
}

/** Blocked statuses have no grid column of their own: handoff_blocked cards
 * sit in the preparing_handoff column and finalization_blocked cards in the
 * in_finalization column, told apart by their red badge (see
 * digital-factory-ui's board-meta.ts boardColumnFor). */
export const NO_COLUMN_STATUSES = new Set(['handoff_blocked', 'finalization_blocked']);

export function boardColumnFor(status: string): string {
  if (status === 'handoff_blocked') return 'preparing_handoff';
  if (status === 'finalization_blocked') return 'in_finalization';
  return status;
}

const TASK_STATUS_META: Record<string, { label: string; color: string }> = {
  todo: { label: 'Todo', color: 'var(--color-text-muted)' },
  ready: { label: 'Ready', color: 'var(--color-warning)' },
  in_progress: { label: 'In Progress', color: 'var(--color-primary)' },
  in_review: { label: 'In Review', color: 'var(--color-warning)' },
  reviewing: { label: 'Reviewing', color: 'var(--color-warning)' },
  review_passed: { label: 'Review Passed', color: 'var(--color-success)' },
  change_requested: { label: 'Changes Requested', color: 'var(--color-warning)' },
  review_incomplete: { label: 'In Review', color: 'var(--color-warning)' },
  blocked: { label: 'Blocked', color: 'var(--color-danger)' },
  done: { label: 'Done', color: 'var(--color-success)' },
  cancelled: { label: 'Cancelled', color: 'var(--color-text-muted)' },
};

export function taskStatusMeta(status: string) {
  return TASK_STATUS_META[status] ?? { label: status, color: 'var(--color-text-muted)' };
}
