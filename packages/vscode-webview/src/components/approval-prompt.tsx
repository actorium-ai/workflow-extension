import { Check, MessageSquare, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApprovalChoice, ApprovalPromptState } from '../utils/types.ts';
import { formatApprovalQuestion } from '../utils/utils.ts';

type ApprovalPromptProps = {
  approval: ApprovalPromptState;
  onRespond: (choice: ApprovalChoice, instructions?: string) => void;
};

const CHOICE_SUMMARY: Record<ApprovalChoice, string> = {
  yes: 'Approved',
  yes_all: 'Allowed for the rest of this session',
  no: 'Rejected',
  instructions: 'Asked for something different',
};

/**
 * Inline Ask-mode approval card — replaces the old native
 * vscode.window.showInformationMessage popup (just Approve/Reject) with a
 * Claude-Code-style card embedded at the tool call's position in the chat,
 * offering the same four choices Claude Code does: Yes / Yes-allow-all-this-
 * session / No / free-text "tell it what to do instead". Resolution never
 * leaves the extension host (see ModeGate.handle / RequestApproval) — there's
 * no server round trip like clarify's, since Ask-mode enforcement is entirely
 * client-side.
 */
export function ApprovalPrompt({ approval, onRespond }: ApprovalPromptProps) {
  const [pending, setPending] = useState(false);
  const [resolved, setResolved] = useState<ApprovalChoice | null>(approval.choice ?? null);
  const [showTextInput, setShowTextInput] = useState(false);
  const [text, setText] = useState('');

  const prevActiveRef = useRef(approval.active);
  useEffect(() => {
    const wasFrozen = !prevActiveRef.current;
    prevActiveRef.current = approval.active;
    if (wasFrozen && approval.active && pending) {
      setPending(false);
      setResolved(null);
    }
  }, [approval.active, pending]);

  const isDone = resolved !== null;
  const locked = !approval.active || pending || isDone;

  const respond = useCallback(
    (choice: ApprovalChoice, instructions?: string) => {
      if (locked) return;
      setResolved(choice);
      setPending(true);
      onRespond(choice, instructions);
    },
    [locked, onRespond],
  );

  const submitInstructions = () => {
    const trimmed = text.trim();
    if (!trimmed || locked) return;
    respond('instructions', trimmed);
  };

  useEffect(() => {
    if (locked) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') respond('no');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [locked, respond]);

  const question = formatApprovalQuestion(approval.tool, approval.params);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <p className="font-medium text-text-primary">{question}</p>

      {isDone ? (
        <div
          className={
            'flex items-center gap-1.5 rounded-md border px-3 py-2' +
            (resolved === 'no'
              ? ' border-danger/30 bg-danger/10'
              : ' border-primary/30 bg-primary/10')
          }
        >
          {resolved === 'no' ? (
            <X className="h-3.5 w-3.5 shrink-0 text-danger" strokeWidth={3} aria-hidden="true" />
          ) : (
            <Check
              className="h-3.5 w-3.5 shrink-0 text-primary"
              strokeWidth={3}
              aria-hidden="true"
            />
          )}
          <p className="min-w-0 truncate text-[13px] text-text-primary">
            {CHOICE_SUMMARY[resolved]}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {(
            [
              ['1', 'Yes', 'yes'],
              ['2', 'Yes, allow all edits this session', 'yes_all'],
              ['3', 'No', 'no'],
            ] as const
          ).map(([num, label, choice]) => (
            <button
              key={choice}
              type="button"
              disabled={locked}
              onClick={() => respond(choice)}
              className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-[13px] font-medium text-text-secondary transition-colors hover:border-primary/40 hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border text-[11px] text-text-muted">
                {num}
              </span>
              {label}
            </button>
          ))}

          {!showTextInput ? (
            <button
              type="button"
              disabled={locked}
              onClick={() => setShowTextInput(true)}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-left text-[13px] font-medium text-text-muted transition-colors hover:border-primary/40 hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Tell it what to do instead
            </button>
          ) : (
            <input
              type="text"
              className="w-full rounded border border-border bg-surface-secondary px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="What should it do instead?"
              value={text}
              disabled={locked}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitInstructions();
              }}
              autoFocus
            />
          )}

          <p className="mt-0.5 text-[11px] text-text-muted">Esc to cancel</p>
        </div>
      )}
    </div>
  );
}
