import { Brain, ChevronRight } from 'lucide-react';

import type { AssistantTurn } from '../utils/types.ts';
import { formatDuration } from '../utils/utils.ts';
import { Markdown } from './markdown';

interface ThinkingDisclosureProps {
  turn: AssistantTurn;
  onToggle: (turnId: string) => void;
}

export function ThinkingDisclosure({ turn, onToggle }: ThinkingDisclosureProps) {
  if (!turn.thinking) return null;

  const expanded = turn.thinkingDone ? !!turn.thinkingExpanded : true;
  const label = turn.thinkingDone
    ? turn.thinkingSeconds != null
      ? 'Thought for ' + formatDuration(turn.thinkingSeconds)
      : 'Show thinking'
    : 'Thinking…';

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className={
          'inline-flex items-center gap-1.5 self-start rounded px-1 py-0.5 text-xs text-text-muted' +
          (turn.thinkingDone
            ? ' cursor-pointer hover:bg-surface-secondary hover:text-text-primary'
            : ' cursor-default')
        }
        onClick={() => turn.thinkingDone && onToggle(turn.id)}
      >
        <Brain className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
        {turn.thinkingDone && (
          <ChevronRight
            className={
              'h-3 w-3 shrink-0 opacity-70 transition-transform' + (expanded ? ' rotate-90' : '')
            }
          />
        )}
      </button>
      {expanded && (
        <Markdown
          className="mt-0.5 border-l border-border pl-2.5 text-text-muted"
          text={turn.thinking}
        />
      )}
    </div>
  );
}
