import {
  BadgeCheck,
  CheckCircle2,
  Circle,
  CircleArrowRight,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CircleMinus,
  CircleX,
  RotateCcw,
} from 'lucide-react';

import { lifecycleMeta, taskStatusMeta, tint } from '../utils/feature-meta.ts';

/** Lucide-style conical flask inside a circle — copied verbatim (same SVG
 * paths) from digital-factory-ui's board/status-glyph.tsx CircleFlask, used
 * for the "In TDD" stage there. Ported as a real component rather than the
 * stock CircleDotDashed stand-in this file used before, since a feature
 * chip's glyph is meant to read as the exact same icon dfui's own board/
 * navigator shows for that stage — not just "some dashed circle". */
function CircleFlask({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M10.2 7.5v2.8l-2 4.2a1.3 1.3 0 0 0 1.2 1.9h5.2a1.3 1.3 0 0 0 1.2-1.9l-2-4.2V7.5" />
      <path d="M9.5 7.5h5" />
    </svg>
  );
}

/** Lucide-style pen inside a circle — copied verbatim from
 * digital-factory-ui's board/status-glyph.tsx CirclePen, used for the "In
 * Design" stage there (active design work). Same rationale as CircleFlask
 * above. */
function CirclePen({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M14.8 8.2l1 1-5.3 5.3-2 0.7 0.7-2 5.3-5.3z" />
      <path d="M15.8 7.2l1 1" />
    </svg>
  );
}

/** Feature lifecycle-stage glyph — same stage -> icon mapping as
 * digital-factory-ui's board/status-glyph.tsx LifecycleIcon (backlog,
 * ready_for_implementation, in_implementation, in_handoff, done, blocked,
 * cancelled use stock lucide icons there too; in_design/in_tdd use the two
 * custom SVGs above, ported verbatim rather than approximated with a stock
 * icon — the two apps must show the exact same glyph for the exact same
 * stage). */
export function LifecycleGlyph({ stage, size = 12 }: { stage: string; size?: number }) {
  const meta = lifecycleMeta(stage);
  const props = { size, color: meta.color, 'aria-hidden': true } as const;
  let icon = <Circle {...props} />;
  if (stage === 'in_design') icon = <CirclePen size={size} color={meta.color} />;
  else if (stage === 'in_tdd') icon = <CircleFlask size={size} color={meta.color} />;
  else if (stage === 'ready_for_implementation') icon = <CircleArrowRight {...props} />;
  else if (stage === 'in_implementation') icon = <CircleDashed {...props} />;
  else if (stage === 'in_handoff') icon = <CircleDot {...props} />;
  else if (stage === 'done') icon = <CheckCircle2 {...props} />;
  else if (stage === 'blocked') icon = <CircleX {...props} />;
  else if (stage === 'cancelled') icon = <CircleMinus {...props} />;

  return (
    <span className="inline-flex shrink-0" title={meta.label}>
      {icon}
    </span>
  );
}

/** Task-status glyph — same status -> icon mapping as digital-factory-ui's
 * board/status-glyph.tsx GlyphIcon (it does have a bespoke icon per task
 * status, contrary to what this file used to claim). */
export function TaskStatusGlyph({ status, size = 11 }: { status: string; size?: number }) {
  const meta = taskStatusMeta(status);
  const props = { size, color: meta.color, 'aria-hidden': true } as const;
  let icon = <Circle {...props} />;
  if (status === 'done') icon = <CheckCircle2 {...props} />;
  else if (status === 'review_passed') icon = <BadgeCheck {...props} />;
  else if (status === 'ready') icon = <CircleDashed {...props} />;
  else if (status === 'in_progress') icon = <CircleDotDashed {...props} />;
  else if (status === 'in_review' || status === 'reviewing' || status === 'review_incomplete')
    icon = <CircleDot {...props} />;
  else if (status === 'blocked') icon = <CircleX {...props} />;
  else if (status === 'change_requested') icon = <RotateCcw {...props} />;
  else if (status === 'cancelled') icon = <CircleMinus {...props} />;

  return (
    <span className="inline-flex shrink-0" title={meta.label}>
      {icon}
    </span>
  );
}

/** Task-status pill with its glyph embedded inside, matching
 * digital-factory-ui's board/status-glyph.tsx StatusBadge — replaces the
 * old pattern of a bare label-only pill next to a separate glyph. */
export function StatusPill({ status, size = 10 }: { status: string; size?: number }) {
  const meta = taskStatusMeta(status);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: meta.color, background: tint(meta.color) }}
    >
      <TaskStatusGlyph status={status} size={size} />
      {meta.label}
    </span>
  );
}
