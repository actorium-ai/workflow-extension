import { File, FileText } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { MentionItem } from '../utils/types.ts';
import { LifecycleGlyph } from './status-glyph.tsx';

interface MentionDropdownProps {
  items: MentionItem[];
  selectedIndex: number;
  activePrefix: string | null;
  onSelect: (index: number) => void;
}

/** Mirrors digital-factory-ui's four pickers (SlashCommandPicker,
 * FileMentionPicker for #, FeatureMentionPicker for //, MentionPicker
 * adapted to local files instead of people for @) — same row shape per
 * trigger type, backed by our existing IDE-side data (panel.ts's
 * _handleMentionAutocomplete). '//' rows use the same per-status
 * LifecycleGlyph the Features sidebar/board use instead of a generic icon —
 * `item.group` IS the feature's lifecycle status for '//' items (see
 * panel.ts's case '//': group: f.status), so no separate field is needed. */
function iconFor(prefix: string | null, item: MentionItem) {
  const className = 'h-3.5 w-3.5 shrink-0 text-text-muted';
  if (prefix === '#') return <FileText className={className} />;
  if (prefix === '//') return <LifecycleGlyph stage={item.group ?? ''} size={13} />;
  if (prefix === '@') return <File className={className} />;
  return null; // '/' slash commands render without an icon, like theirs
}

export function MentionDropdown({
  items,
  selectedIndex,
  activePrefix,
  onSelect,
}: MentionDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keeps the highlighted row in view as ArrowUp/ArrowDown moves
  // selectedIndex past the edge of the scrollable container — mirrors
  // digital-factory-ui's FeatureMentionPicker (listRef + scrollIntoView on
  // activeIndex change). Without this, the dropdown's own max-h-64
  // overflow-y-auto clips the list but arrow-key navigation never scrolls
  // it, so selecting past the visible rows looked like the down arrow
  // "didn't scroll" at all.
  useEffect(() => {
    const active = containerRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!items.length) return null;

  const isSlash = activePrefix === '/';
  // Precomputed (rather than tracked via a mutated outer variable inside the
  // JSX .map() below) so the render callback stays a pure function of its
  // own item — each row just looks up whether it starts a new group.
  const showHeaderAt = items.map(
    (item, i) => item.group !== undefined && item.group !== items[i - 1]?.group,
  );

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Suggestions"
      className="absolute inset-x-0 bottom-full z-50 mb-1.5 max-h-64 overflow-y-auto rounded-md border border-border bg-surface shadow-md"
      onMouseDown={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-mention-index]');
        if (!el) return;
        e.preventDefault();
        onSelect(Number(el.dataset.mentionIndex));
      }}
    >
      <ul className="py-1">
        {items.map((item, i) => {
          const showHeader = showHeaderAt[i];
          const active = i === selectedIndex;
          return (
            <li key={i}>
              {showHeader && (
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold tracking-wider text-text-muted uppercase first:pt-1.5">
                  {item.group}
                </div>
              )}
              <div
                role="option"
                aria-selected={active}
                data-mention-index={i}
                data-active={active}
                className={
                  'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors' +
                  (active
                    ? ' bg-primary/10 text-text-primary'
                    : ' text-text-primary hover:bg-surface-secondary')
                }
              >
                {iconFor(activePrefix, item)}
                {isSlash ? (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-mono font-medium">{item.label}</span>
                    {item.description && (
                      <span className="text-xs text-text-muted">{item.description}</span>
                    )}
                  </span>
                ) : activePrefix === '//' ? (
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
                    <span className="shrink-0 font-mono font-medium">{item.label}</span>
                    {item.description && (
                      <span className="truncate text-[11px] text-text-muted">
                        . {item.description}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.label}</span>
                    {item.description && activePrefix !== '@' && (
                      <span className="truncate text-[11px] text-text-muted">
                        {item.description}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
