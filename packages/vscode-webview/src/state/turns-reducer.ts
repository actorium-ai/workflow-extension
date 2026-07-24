import type { ApprovalChoice, AssistantTurn, OperationalMode, Turn } from '../utils/types.ts';

// Monotonic id counter for the lifetime of this webview instance — reset to
// the restored-turn count on first mount (in useChatController) so ids never
// collide with history pulled back from vscode.getState().
let turnSeqCounter = 0;

export function nextTurnId(prefix: string): string {
  return prefix + turnSeqCounter++;
}

/** Resets the counter to match restored history's length — called once by
 * useChatController's useReducer initializer, never elsewhere. Exposed as a
 * function (not a raw exported `let`) so this module stays the single owner
 * of the counter's mutation, matching the rest of this file's shape. */
export function seedTurnIdCounter(restoredCount: number): void {
  turnSeqCounter = restoredCount;
}

function newAssistantTurn(id: string, now: number): AssistantTurn {
  return {
    id,
    role: 'assistant',
    segments: [],
    thinking: '',
    // Stamped at TURN start, not at the first reasoning delta — mirrors
    // digital-factory-ui's recordTurnDuration (measures from when the turn
    // began to when reasoning finished, not from-first-delta). Some
    // providers don't stream reasoning_content incrementally; when the
    // model returns its whole reasoning block in one burst, "first
    // reasoning delta" and "reasoning done" can arrive back-to-back with
    // ~0ms apart even though the model spent real time thinking — that
    // showed as a nonsensical "Thought for 0s" every time, not just for
    // genuinely fast turns. Measuring from turn start instead reflects the
    // real elapsed time regardless of how the provider chunks the stream.
    thinkingStart: now,
    thinkingDone: false,
    thinkingSeconds: null,
    thinkingExpanded: true,
  };
}

export type TurnsAction =
  | { type: 'addUser'; id: string; text: string; queued?: boolean }
  | { type: 'addAssistant'; id: string; now: number }
  | { type: 'appendText'; turnId: string; text: string }
  | { type: 'reasoning'; turnId: string; content: string }
  | { type: 'reasoningDone'; turnId: string; now: number }
  | { type: 'toolStart'; turnId: string; callId: string; name: string }
  | { type: 'toolParams'; turnId: string; callId: string; params: Record<string, unknown> }
  | { type: 'toolComplete'; turnId: string; callId: string; output?: unknown }
  | {
      type: 'clarify';
      turnId: string;
      clarifyId: string;
      question: string;
      choices: string[] | null;
      multiple: boolean;
    }
  | { type: 'clarifyAnswered'; turnId: string; clarifyId: string; answer: string }
  | {
      type: 'approval';
      turnId: string;
      callId: string;
      tool: string;
      params: Record<string, unknown>;
    }
  | {
      type: 'approvalAnswered';
      turnId: string;
      callId: string;
      choice: ApprovalChoice;
    }
  | { type: 'toggleThinking'; turnId: string }
  | { type: 'toggleToolOutput'; turnId: string; callId: string }
  | { type: 'dequeueUser' }
  | { type: 'markNoResponse'; turnId: string }
  | { type: 'restore'; turns: Turn[] }
  | { type: 'clear' };

export function turnsReducer(state: Turn[], action: TurnsAction): Turn[] {
  switch (action.type) {
    case 'addUser':
      return [...state, { id: action.id, role: 'user', text: action.text, queued: action.queued }];
    case 'addAssistant':
      return [...state, newAssistantTurn(action.id, action.now)];
    case 'appendText':
      return state.map((t) => {
        if (t.id !== action.turnId || t.role !== 'assistant') return t;
        const segments = [...t.segments];
        const last = segments[segments.length - 1];
        if (last?.kind === 'text') {
          segments[segments.length - 1] = { kind: 'text', text: last.text + action.text };
        } else {
          segments.push({ kind: 'text', text: action.text });
        }
        return { ...t, segments };
      });
    case 'reasoning':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? { ...t, thinking: t.thinking + action.content }
          : t,
      );
    case 'reasoningDone':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? {
              ...t,
              thinkingDone: true,
              thinkingExpanded: false,
              thinkingSeconds:
                t.thinkingStart != null
                  ? Math.round((action.now - t.thinkingStart) / 1000)
                  : t.thinkingSeconds,
            }
          : t,
      );
    case 'toolStart':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? {
              ...t,
              segments: [
                ...t.segments,
                {
                  kind: 'tool',
                  tc: { callId: action.callId, name: action.name, status: 'running' },
                },
              ],
            }
          : t,
      );
    case 'toolParams':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? {
              ...t,
              segments: t.segments.map((seg) =>
                seg.kind === 'tool' && seg.tc.callId === action.callId
                  ? { ...seg, tc: { ...seg.tc, params: action.params } }
                  : seg,
              ),
            }
          : t,
      );
    case 'toolComplete':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? {
              ...t,
              segments: t.segments.map((seg) =>
                seg.kind === 'tool' && seg.tc.callId === action.callId
                  ? {
                      ...seg,
                      tc: {
                        ...seg.tc,
                        status: 'done',
                        output: action.output !== undefined ? action.output : seg.tc.output,
                      },
                    }
                  : seg,
              ),
            }
          : t,
      );
    case 'clarify':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? {
              ...t,
              segments: [
                ...t.segments,
                {
                  kind: 'clarify',
                  clarify: {
                    clarifyId: action.clarifyId,
                    question: action.question,
                    choices: action.choices,
                    multiple: action.multiple,
                    active: true,
                  },
                },
              ],
            }
          : t,
      );
    case 'clarifyAnswered':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? {
              ...t,
              segments: t.segments.map((seg) =>
                seg.kind === 'clarify' && seg.clarify.clarifyId === action.clarifyId
                  ? { ...seg, clarify: { ...seg.clarify, active: false, answer: action.answer } }
                  : seg,
              ),
            }
          : t,
      );
    case 'approval':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? {
              ...t,
              segments: [
                ...t.segments,
                {
                  kind: 'approval',
                  approval: {
                    callId: action.callId,
                    tool: action.tool,
                    params: action.params,
                    active: true,
                  },
                },
              ],
            }
          : t,
      );
    case 'approvalAnswered':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? {
              ...t,
              segments: t.segments.map((seg) =>
                seg.kind === 'approval' && seg.approval.callId === action.callId
                  ? { ...seg, approval: { ...seg.approval, active: false, choice: action.choice } }
                  : seg,
              ),
            }
          : t,
      );
    case 'toggleThinking':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant' && t.thinkingDone
          ? { ...t, thinkingExpanded: !t.thinkingExpanded }
          : t,
      );
    case 'toggleToolOutput':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant'
          ? {
              ...t,
              segments: t.segments.map((seg) =>
                seg.kind === 'tool' && seg.tc.callId === action.callId
                  ? { ...seg, tc: { ...seg.tc, expanded: !seg.tc.expanded } }
                  : seg,
              ),
            }
          : t,
      );
    case 'dequeueUser': {
      const idx = state.findIndex((t) => t.role === 'user' && t.queued);
      if (idx === -1) return state;
      return state.map((t, i) => (i === idx ? { ...t, queued: false } : t));
    }
    case 'markNoResponse':
      return state.map((t) =>
        t.id === action.turnId && t.role === 'assistant' && t.segments.length === 0 && !t.thinking
          ? {
              ...t,
              segments: [
                {
                  kind: 'text',
                  text: '_(no response received — check that the coding agent service is running and reachable)_',
                },
              ],
            }
          : t,
      );
    case 'restore':
      return action.turns;
    case 'clear':
      return [];
    default:
      return state;
  }
}

export interface PersistedChatState {
  turns?: Turn[];
  mode?: OperationalMode;
}

/**
 * Normalize one persisted turn to the current shape. vscode.getState() can
 * hand back turns saved by an OLDER version of this webview — e.g. an
 * assistant turn from before AssistantSegment existed still has
 * `text`/`toolCalls`/`toolsExpanded` instead of `segments`, which would
 * otherwise crash MessageList's `turn.segments.map(...)` with "Cannot read
 * properties of undefined (reading 'map')" on the very first render after
 * an extension update. Approximates the old "all text, then all tool
 * calls" layout as one text segment followed by one segment per tool call
 * — the best reconstruction possible from data that never recorded true
 * interleaving order.
 */
export function migrateTurn(t: unknown): Turn {
  const raw = t as Record<string, unknown>;
  if (raw?.role !== 'assistant' || Array.isArray(raw.segments)) {
    return t as Turn;
  }
  const legacyText = typeof raw.text === 'string' ? raw.text : '';
  const legacyToolCalls = Array.isArray(raw.toolCalls) ? raw.toolCalls : [];
  return {
    id: String(raw.id ?? ''),
    role: 'assistant',
    segments: [
      ...(legacyText ? [{ kind: 'text' as const, text: legacyText }] : []),
      ...legacyToolCalls.map((tc) => ({ kind: 'tool' as const, tc })),
    ],
    thinking: typeof raw.thinking === 'string' ? raw.thinking : '',
    thinkingStart: typeof raw.thinkingStart === 'number' ? raw.thinkingStart : null,
    thinkingDone: !!raw.thinkingDone,
    thinkingSeconds: typeof raw.thinkingSeconds === 'number' ? raw.thinkingSeconds : null,
    thinkingExpanded: !!raw.thinkingExpanded,
  };
}
