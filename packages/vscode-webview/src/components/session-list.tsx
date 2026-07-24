import { Trash2 } from 'lucide-react';

import { HighlightedText } from '../utils/chip-styles.tsx';
import type { SessionSummary } from '../utils/types.ts';
import { formatRelativeTime } from '../utils/utils.ts';

interface SessionListProps {
  sessions: SessionSummary[];
  onLoad: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  /** Feature id -> name, for HighlightedText to resolve `<ft:>`/`<d:>` tags
   * in a session's title/excerpt to a readable name instead of the raw
   * UUID those tags carry post-send — see navigator.tsx's own comment on
   * where this comes from. */
  featureNames?: Record<string, string>;
  /** Feature id -> current_stage, for a `<ft:>` chip's LifecycleGlyph. */
  featureStages?: Record<string, string>;
}

/** Mirrors digital-factory-ui's SessionHistoryList — same empty state and
 * relative-time row shape as the old chat-header history popover this
 * replaces. On hover, the relative-time text is swapped for a delete
 * button IN THE SAME SLOT (not overlaid on top of it) — mirrors Claude
 * Code's own session list. The row's click target is a `<div
 * role="button">`, not a real `<button>`, specifically so the delete
 * button can be a real nested `<button>` sibling in that slot without
 * creating an invalid button-inside-button DOM (which the previous
 * absolutely-positioned-overlay approach avoided a different way, at the
 * cost of visually overlapping the time instead of replacing it). */
export function SessionList({
  sessions,
  onLoad,
  onDelete,
  featureNames,
  featureStages,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="px-3 py-3 text-center text-xs text-text-muted">No conversations yet.</div>
    );
  }

  return (
    <ul className="px-1">
      {sessions.map((s) => (
        <li key={s.id} className="group">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onLoad(s.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onLoad(s.id);
            }}
            className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-surface-secondary"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-text-primary">
                <HighlightedText
                  text={s.title}
                  featureNames={featureNames}
                  featureStages={featureStages}
                />
              </span>
              {/* Fixed height on the slot itself (not just its children) —
                  the time text and the delete button previously had
                  different rendered heights (the button's own padding made
                  it taller than the bare 10px time text), so swapping one
                  for the other on hover grew the whole row instead of
                  staying static. */}
              <span className="flex h-4 shrink-0 items-center">
                <span className="text-[10px] text-text-muted group-hover:hidden">
                  {formatRelativeTime(s.last_active_at)}
                </span>
                <button
                  type="button"
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  className="hidden h-4 w-4 items-center justify-center rounded text-text-muted opacity-70 hover:bg-surface hover:opacity-100 group-hover:flex"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            </div>
            {s.last_message_excerpt && (
              <div className="mt-0.5 truncate text-[11px] text-text-muted">
                <HighlightedText
                  text={s.last_message_excerpt}
                  featureNames={featureNames}
                  featureStages={featureStages}
                />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
