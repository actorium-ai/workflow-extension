import { Check, HelpCircle, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ClarifyPromptState } from '../utils/types.ts';

type ClarifyPromptProps = {
  clarify: ClarifyPromptState;
  onSubmit: (response: string) => void;
};

/** A choice can carry an optional description via a `Label|Description`
 * convention (see shared.md's clarify guidance) — split it here so the label
 * is what's actually sent as the answer; the description is UI-only, never
 * round-tripped back to the model. Plain choices with no `|` are unaffected. */
function splitChoice(raw: string): { label: string; description: string | null } {
  const idx = raw.indexOf('|');
  if (idx === -1) return { label: raw.trim(), description: null };
  return { label: raw.slice(0, idx).trim(), description: raw.slice(idx + 1).trim() || null };
}

/**
 * Inline card for the `clarify` tool — the agent is blocked waiting on this
 * answer (see agent.clarify SSE event / POST /threads/{session_id}/clarify).
 * Ported from digital-factory-ui's clarify-prompt.tsx (same backend
 * contract, same shared.md convention), adapted to this webview's theme
 * tokens. Predefined choices render as a single-select radio list by
 * default (pick exactly one), or a multi-select checkbox list when
 * `clarify.multiple` is set, each optionally with a description subtitle,
 * plus an "Other" free-text addition. Nothing is sent until "Submit", so
 * picks can be changed first. Once confirmed, the whole card collapses to a
 * single "You chose ..." summary line. Open-ended questions (no `choices`
 * at all) skip all of this: just a text input + send.
 */
export function ClarifyPrompt({ clarify, onSubmit }: ClarifyPromptProps) {
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(clarify.answer ?? null);
  const [pickedSet, setPickedSet] = useState<Set<string>>(new Set());
  const [showTextInput, setShowTextInput] = useState(!clarify.choices?.length);
  const [text, setText] = useState('');

  const prevActiveRef = useRef(clarify.active);
  useEffect(() => {
    const wasFrozen = !prevActiveRef.current;
    prevActiveRef.current = clarify.active;
    if (wasFrozen && clarify.active && pending) {
      setPending(false);
      setConfirmed(null);
    }
  }, [clarify.active, pending]);

  const isDone = confirmed !== null;
  const locked = !clarify.active || pending || isDone;
  const isOpenEnded = !clarify.choices || clarify.choices.length === 0;

  const togglePick = (label: string) => {
    if (locked) return;
    if (!clarify.multiple) {
      setText('');
      setPickedSet((prev) => (prev.has(label) ? prev : new Set([label])));
      return;
    }
    setPickedSet((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const finalize = (joined: string) => {
    const trimmed = joined.trim();
    if (!trimmed || locked) return;
    setConfirmed(trimmed);
    setPending(true);
    onSubmit(trimmed);
    setText('');
    setPickedSet(new Set());
    setShowTextInput(!clarify.choices?.length);
  };

  const submitOpenEnded = () => finalize(text);

  const submitChoices = () => {
    if (!clarify.multiple) {
      finalize(text.trim() || [...pickedSet][0] || '');
      return;
    }
    const parts = [...pickedSet];
    const extra = text.trim();
    if (extra) parts.push(extra);
    finalize(parts.join(', '));
  };

  const hasSelection = pickedSet.size > 0 || text.trim().length > 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex items-start gap-1.5">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
        <p className="font-medium text-text-primary">{clarify.question}</p>
      </div>

      {isDone ? (
        <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
          <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={3} aria-hidden="true" />
          <p className="min-w-0 truncate text-[13px] text-text-primary">
            You chose <span className="font-medium">{confirmed}</span>
          </p>
        </div>
      ) : isOpenEnded ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
            placeholder="Type your answer…"
            value={text}
            disabled={locked}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitOpenEnded();
            }}
            autoFocus
          />
          <button
            type="button"
            disabled={locked || !text.trim()}
            onClick={submitOpenEnded}
            className="flex shrink-0 items-center justify-center rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send answer"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          className="flex flex-col gap-1"
          role={clarify.multiple ? 'group' : 'radiogroup'}
          aria-label={clarify.multiple ? 'Choices (select any that apply)' : 'Choices'}
        >
          {clarify.choices?.map((choice) => {
            const { label, description } = splitChoice(choice);
            const isPicked = pickedSet.has(label);
            return (
              <button
                key={choice}
                type="button"
                role={clarify.multiple ? 'checkbox' : 'radio'}
                aria-checked={isPicked}
                disabled={locked}
                onClick={() => togglePick(label)}
                className={
                  'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed' +
                  (isPicked
                    ? ' border-primary bg-primary/10 text-text-primary'
                    : ' border-border text-text-secondary hover:border-primary/40 hover:bg-surface-secondary disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent')
                }
              >
                <span
                  className={
                    'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border' +
                    (clarify.multiple ? ' rounded-[4px]' : ' rounded-full') +
                    (isPicked ? ' border-primary bg-primary' : ' border-border')
                  }
                  aria-hidden="true"
                >
                  {isPicked && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{label}</span>
                  {description && (
                    <span className="mt-0.5 block text-[12px] leading-snug font-normal text-text-muted">
                      {description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          {!showTextInput && (
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                if (!clarify.multiple) setPickedSet(new Set());
                setShowTextInput(true);
              }}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-left text-[13px] font-medium text-text-muted transition-colors hover:border-primary/40 hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className={
                  'h-3.5 w-3.5 shrink-0 border border-border' +
                  (clarify.multiple ? ' rounded-[4px]' : ' rounded-full')
                }
                aria-hidden="true"
              />
              Other…
            </button>
          )}
          {showTextInput && (
            <input
              type="text"
              className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="Add your own…"
              value={text}
              disabled={locked}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitChoices();
              }}
              autoFocus
            />
          )}

          {hasSelection && (
            <button
              type="button"
              disabled={locked}
              onClick={submitChoices}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Submit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
