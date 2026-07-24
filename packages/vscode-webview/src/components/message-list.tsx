import { useLayoutEffect, useRef } from 'react';

import { applyLeadingCommandTag } from '../utils/remark-mention-chips.ts';
import type { ApprovalChoice, Turn } from '../utils/types.ts';
import { ActoriumLogo } from './actorium-logo';
import { AgentLoader } from './agent-loader';
import { ApprovalPrompt } from './approval-prompt';
import { ClarifyPrompt } from './clarify-prompt';
import { Markdown } from './markdown';
import { ThinkingDisclosure } from './thinking-disclosure';
import { ToolCallRow } from './tool-calls';

const STARTER_PROMPTS = [
  'Explain what this file does',
  'Find where this function is used',
  'Write tests for the selected code',
  'Review my recent changes for bugs',
];

function EmptyChatState({ onPromptClick }: { onPromptClick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <ActoriumLogo size={48} />
      <div className="space-y-1">
        <p className="text-[15px] font-semibold text-text-primary">How can I help?</p>
        <p className="text-[12px] text-text-muted">
          Ask a question or pick a starting point below.
        </p>
      </div>
      <div className="mt-1 flex w-full max-w-[320px] flex-col gap-1.5">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPromptClick(prompt)}
            className="rounded-md border border-border bg-bg px-3 py-2 text-left text-[12px] text-text-secondary transition-colors hover:border-primary/50 hover:bg-surface hover:text-text-primary"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

interface MessageListProps {
  visible: boolean;
  turns: Turn[];
  isBusy: boolean;
  loaderSeconds: number;
  onToggleThinking: (turnId: string) => void;
  onToggleToolOutput: (turnId: string, callId: string) => void;
  onSubmitClarify: (turnId: string, clarifyId: string, answer: string) => void;
  onRespondApproval: (
    turnId: string,
    callId: string,
    choice: ApprovalChoice,
    instructions?: string,
  ) => void;
  /** Populates the composer with a starter prompt — does not send it (matches
   * digital-factory-ui's own EmptyStateCTARow "populate, don't send"
   * behavior for its history-screen suggestions). */
  onPromptClick: (text: string) => void;
}

export function MessageList({
  visible,
  turns,
  isBusy,
  loaderSeconds,
  onToggleThinking,
  onToggleToolOutput,
  onSubmitClarify,
  onRespondApproval,
  onPromptClick,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
  };

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turns, isBusy]);

  // Mirrors the per-turn null-render checks below — a turn with no
  // meaningful content (e.g. a user turn that's still being typed
  // server-side) shouldn't count as "there's a conversation here" and
  // suppress the welcome/starter-prompt state.
  const hasVisibleContent = turns.some((turn) =>
    turn.role === 'user' ? !!turn.text.trim() : !!turn.thinking || turn.segments.length > 0,
  );

  if (!hasVisibleContent && !isBusy) {
    return (
      <div className={(visible ? 'flex' : 'hidden') + ' flex-1 flex-col overflow-y-auto p-3'}>
        <EmptyChatState onPromptClick={onPromptClick} />
      </div>
    );
  }

  return (
    <div
      className={(visible ? 'flex' : 'hidden') + ' flex-1 flex-col gap-2.5 overflow-y-auto p-3'}
      ref={containerRef}
      onScroll={handleScroll}
    >
      {turns.map((turn) => {
        if (turn.role === 'user') {
          if (!turn.text.trim()) return null;
          return (
            <div className="flex flex-col items-end" key={turn.id}>
              <div
                className={
                  'max-w-[88%] rounded-lg border border-primary/40 bg-primary/20 px-3 py-2' +
                  (turn.queued ? ' opacity-55' : '')
                }
              >
                <Markdown text={applyLeadingCommandTag(turn.text)} />
                {turn.queued && (
                  <span className="mt-0.5 block text-[10px] italic opacity-85">
                    Queued — sends after the current turn
                  </span>
                )}
              </div>
            </div>
          );
        }

        const hasBody = !!turn.thinking || turn.segments.length > 0;
        if (!hasBody) return null;

        return (
          <div className="flex flex-col items-stretch gap-2" key={turn.id}>
            <ThinkingDisclosure turn={turn} onToggle={onToggleThinking} />
            {turn.segments.map((seg, i) => {
              if (seg.kind === 'text') return <Markdown key={i} text={seg.text} />;
              if (seg.kind === 'clarify') {
                return (
                  <ClarifyPrompt
                    key={seg.clarify.clarifyId}
                    clarify={seg.clarify}
                    onSubmit={(answer) => onSubmitClarify(turn.id, seg.clarify.clarifyId, answer)}
                  />
                );
              }
              if (seg.kind === 'approval') {
                return (
                  <ApprovalPrompt
                    key={seg.approval.callId}
                    approval={seg.approval}
                    onRespond={(choice, instructions) =>
                      onRespondApproval(turn.id, seg.approval.callId, choice, instructions)
                    }
                  />
                );
              }
              return (
                <ToolCallRow
                  key={seg.tc.callId}
                  turnId={turn.id}
                  tc={seg.tc}
                  onToggleOutput={onToggleToolOutput}
                />
              );
            })}
          </div>
        );
      })}
      {isBusy && <AgentLoader seconds={loaderSeconds} />}
    </div>
  );
}
