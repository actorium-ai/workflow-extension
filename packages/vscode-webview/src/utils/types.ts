import type {
  ApprovalChoice,
  ApprovalPromptState,
  ClarifyPromptState,
  FeatureSummary,
  MeUser,
  ModelOption,
  OperationalMode,
  SessionSummary,
  StorageDocument,
  TaskSummary,
  VersionEntry,
} from '@workflow-extension/shared';

export type {
  ApprovalChoice,
  ApprovalPromptState,
  ClarifyPromptState,
  FeatureSummary,
  MeUser,
  ModelOption,
  OperationalMode,
  SessionSummary,
  StorageDocument,
  TaskSummary,
  VersionEntry,
};

/** Mirrors packages/vscode/src/chat/panel.ts's ActiveEditorContext — pushed
 * live by the extension host so the composer can show what file/selection
 * is about to be attached (Claude-Code-style context chip), independent of
 * ContextGatherer's own unconditional per-send gather() call. */
export interface ActiveEditorContext {
  path: string;
  selection: { startLine: number; endLine: number } | null;
}

export interface ToolCallState {
  callId: string;
  name: string;
  status: 'running' | 'done';
  output?: unknown;
  expanded?: boolean;
  /** Set once the hermes.tool.deferred event's params arrive — see
   * ChatPanelProvider.setToolParams. Only ever populated for the IDE's own
   * client-executed tools (read_file, edit_file, run_command, etc.); a
   * server-side tool (query_rag, get_workspace_context, ...) only ever gets
   * toolStart/toolComplete, which carry no params. */
  params?: Record<string, unknown>;
}

/**
 * One ordered piece of an assistant turn's output — text, tool calls, and
 * clarify prompts interleaved in the exact order the agent produced them
 * (mirrors opencode's flat Part[] model:
 * packages/session-ui/src/context/data.tsx's `part: {[messageID]: Part[]}`),
 * rather than "all text, then all tool calls" — so a Read → explain → Edit
 * → explain-more sequence renders in that order instead of every tool call
 * collapsing to the end of the turn.
 */
export type AssistantSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; tc: ToolCallState }
  | { kind: 'clarify'; clarify: ClarifyPromptState }
  | { kind: 'approval'; approval: ApprovalPromptState };

export interface AssistantTurn {
  id: string;
  role: 'assistant';
  segments: AssistantSegment[];
  thinking: string;
  thinkingStart: number | null;
  thinkingDone: boolean;
  thinkingSeconds: number | null;
  thinkingExpanded: boolean;
}

export interface UserTurn {
  id: string;
  role: 'user';
  text: string;
  queued?: boolean;
}

export type Turn = AssistantTurn | UserTurn;

export interface MentionItem {
  label: string;
  description: string;
  group?: string;
  /** What actually gets inserted into the input on selection, when it
   * differs from the displayed `label` — e.g. a `#` doc's label is just the
   * friendly filename ("tasks.md") but the inserted token needs the owning
   * feature's slug too ("distributed-agent-team/tasks.md") to disambiguate
   * same-named files across features, mirroring digital-factory-ui's
   * FileMentionItem.label vs insertFileMention's token. Falls back to
   * `label` when unset (every other mention kind — `//`'s label already
   * *is* the slug to insert). */
  insertValue?: string;
}

export function isAssistantTurn(turn: Turn): turn is AssistantTurn {
  return turn.role === 'assistant';
}
