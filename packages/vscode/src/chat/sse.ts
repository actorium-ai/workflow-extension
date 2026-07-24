import {
  type ChatTurnRequest,
  CODING_IDE_SOURCE,
  type CreateSessionResponse,
  type CreditInfo,
  type DeferredToolCall,
  type IDEContext,
  type ModelsResponse,
  type ToolResultPayload,
  type ToolResultRequest,
} from '@workflow-extension/shared';

export type TextCallback = (text: string) => void;
export type DeferredCallback = (deferred: DeferredToolCall) => void;
export type ReasoningCallback = (content: string) => void;
export type ToolStartCallback = (callId: string, name: string) => void;
export type ToolDoneCallback = (callId: string, name: string) => void;
export type ClarifyCallback = (
  clarifyId: string,
  question: string,
  choices: string[] | null,
  multiple: boolean,
) => void;
export type CostCallback = (info: CreditInfo) => void;
export type ErrorCallback = (message: string) => void;

const MULTI_SELECT_SUFFIX_RE = /\s*\(select all that apply\)\s*$/i;

export type SSEParsedEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'reasoningDone' }
  | { kind: 'toolStart'; callId: string; name: string }
  | { kind: 'toolDone'; callId: string; name: string }
  | { kind: 'deferred'; toolCallId: string; tool: string; params: Record<string, unknown> }
  | {
      kind: 'clarify';
      clarifyId: string;
      question: string;
      choices: string[] | null;
      multiple: boolean;
    }
  | { kind: 'error'; message: string };

/**
 * Parse one hermes-native SSE frame into zero or more internal events.
 *
 * The wire format (see hermes-agent's src/streaming/sse.py — HermesSSETranslator):
 *   - `event: agent.reasoning` → {object: "reasoning.delta"|"reasoning.done", content}
 *   - `event: hermes.tool.progress` → {tool, toolCallId, status: "running"|"completed"}
 *   - `event: hermes.tool.deferred` → {tool_call_id, tool, params} — a tool the
 *     IDE must execute locally. Unlike the old /coding/chat flow, this does
 *     NOT end the turn: it's an opencode MCP tool call blocking synchronously
 *     inside this still-open /chat request (see agent_dispatch.py's
 *     _run_opencode_turn) — the stream keeps going once the caller resolves
 *     it via POST /coding/sessions/{session_id}/tool-result (sendToolResult).
 *   - `event: agent.clarify` → {clarify_id, question, choices} — the `clarify`
 *     tool (part of the SAME "clarify" toolset a DOC-verdict turn shares
 *     with the browser chat) blocks the turn server-side the same way, just
 *     resolved via POST /threads/{session_id}/clarify (answerClarify) instead
 *     of the coding-sessions tool-result endpoint.
 *   - default `data:` frames (no `event:` line) are OpenAI-style
 *     chat.completion.chunk objects carrying choices[0].delta.content and
 *     choices[0].finish_reason ("error" siblings a top-level hermes.error).
 *
 * Deliberately duck-types `raw` (no `type` discriminator field exists on the
 * wire — the `event:` line is the only discriminant) rather than trusting a
 * shape that was never actually part of the backend's contract.
 */
export function parseSSEFrame(
  eventName: string | undefined,
  raw: Record<string, unknown>,
): SSEParsedEvent[] {
  if (eventName === 'agent.reasoning') {
    if (raw.object === 'reasoning.done') {
      return [{ kind: 'reasoningDone' }];
    }
    const content = typeof raw.content === 'string' ? raw.content : '';
    return content ? [{ kind: 'reasoning', content }] : [];
  }

  if (eventName === 'hermes.tool.progress') {
    const status = String(raw.status ?? '');
    const name = String(raw.tool ?? '');
    const callId = String(raw.toolCallId ?? '');
    if (!callId) return [];
    if (status === 'running') return [{ kind: 'toolStart', callId, name }];
    if (status === 'completed') return [{ kind: 'toolDone', callId, name }];
    return [];
  }

  if (eventName === 'hermes.tool.deferred') {
    const toolCallId = String(raw.tool_call_id ?? '');
    const tool = String(raw.tool ?? '');
    if (!toolCallId || !tool) return [];
    return [
      { kind: 'deferred', toolCallId, tool, params: (raw.params ?? {}) as Record<string, unknown> },
    ];
  }

  if (eventName === 'agent.clarify') {
    const clarifyId = String(raw.clarify_id ?? '');
    const rawQuestion = typeof raw.question === 'string' ? raw.question : '';
    if (!clarifyId || !rawQuestion) return [];
    const choices = Array.isArray(raw.choices) ? (raw.choices as string[]) : null;
    const multiple = MULTI_SELECT_SUFFIX_RE.test(rawQuestion);
    const question = rawQuestion.replace(MULTI_SELECT_SUFFIX_RE, '').trim();
    return [{ kind: 'clarify', clarifyId, question, choices, multiple }];
  }

  // hermes.artifact.saved and any other extension event: not applicable to
  // the IDE (no document/feature artifacts to refresh) — ignore.
  if (eventName) {
    return [];
  }

  // No `event:` line — a base chat.completion.chunk frame.
  const choices = raw.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const delta = choice?.delta as Record<string, unknown> | undefined;
  const events: SSEParsedEvent[] = [];

  const content = delta?.content;
  if (typeof content === 'string' && content.length > 0) {
    events.push({ kind: 'delta', text: content });
  }

  if (choice?.finish_reason === 'error') {
    const hermesError = (raw.hermes as Record<string, unknown> | undefined)?.error;
    events.push({ kind: 'error', message: String(hermesError ?? 'Agent error') });
  }

  return events;
}

/**
 * SSE client for hermes-agent's chat endpoint.
 *
 * Sends POST /api/v1/chat with SSE streaming response and parses the frames
 * via parseSSEFrame above. Stateful server-side (unlike the old /coding/chat):
 * the server loads prior turns itself from session_id, so this client only
 * ever sends the LATEST message, never a resent history array — see
 * ChatTurnRequest's doc comment in shared/types.ts.
 */
export class SseClient {
  private _model = '';
  private _sessionId: string | null = null;
  private _abortController: AbortController | null = null;
  private _onDeferred: DeferredCallback | null = null;
  private _onReasoning: ReasoningCallback | null = null;
  private _onReasoningDone: (() => void) | null = null;
  private _onToolStart: ToolStartCallback | null = null;
  private _onToolDone: ToolDoneCallback | null = null;
  private _onClarify: ClarifyCallback | null = null;
  private _onCost: CostCallback | null = null;
  private _onError: ErrorCallback | null = null;

  constructor(
    private readonly getToken: () => Promise<string | null>,
    private readonly getAgentUrl: () => string,
    private readonly getWorkspaceId: () => string | null,
  ) {}

  /**
   * Set the catalog model id to send with every subsequent turn — empty
   * string defers to the server's env-var default.
   */
  setModel(model: string): void {
    this._model = model;
  }

  /**
   * Fetch the selectable model catalog from GET /api/v1/models (same
   * model_catalog table the browser app's picker reads). Returns null on any
   * failure (not authenticated, network error, non-2xx) — callers should
   * fail open (chat still works with the server's env-var default).
   */
  async fetchModels(): Promise<ModelsResponse | null> {
    const token = await this.getToken();
    if (!token) {
      return null;
    }
    try {
      const resp = await fetch(`${this.getAgentUrl()}/api/v1/models`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        return null;
      }
      return (await resp.json()) as ModelsResponse;
    } catch {
      return null;
    }
  }

  /** Register a callback for deferred tool calls the IDE must execute locally. */
  onDeferredToolCall(callback: DeferredCallback): void {
    this._onDeferred = callback;
  }

  /** Register a callback for reasoning-trace deltas (agent.reasoning). */
  onReasoning(callback: ReasoningCallback): void {
    this._onReasoning = callback;
  }

  /** Register a callback fired once the reasoning trace for a turn is complete. */
  onReasoningDone(callback: () => void): void {
    this._onReasoningDone = callback;
  }

  /** Register a callback fired when a (server-side) tool call starts running. */
  onToolStart(callback: ToolStartCallback): void {
    this._onToolStart = callback;
  }

  /** Register a callback fired when a (server-side) tool call completes. */
  onToolDone(callback: ToolDoneCallback): void {
    this._onToolDone = callback;
  }

  /** Register a callback for a pending clarify prompt (agent.clarify) the
   * turn is blocked on — see answerClarify(). */
  onClarify(callback: ClarifyCallback): void {
    this._onClarify = callback;
  }

  /**
   * Register a callback for cost/credit events. Not currently emitted by the
   * chat endpoint (cost is reported to a backend service, not streamed) —
   * kept for forward compatibility with CreditsStatusBar.
   */
  onCost(callback: CostCallback): void {
    this._onCost = callback;
  }

  /** Register a callback for a turn-ending error frame. */
  onError(callback: ErrorCallback): void {
    this._onError = callback;
  }

  /**
   * Resume an existing conversation by id (e.g. restoring from session
   * history) — the next sendMessage() continues it rather than creating a
   * new session.
   */
  setSessionId(sessionId: string | null): void {
    this._sessionId = sessionId;
  }

  /**
   * The session id the next sendMessage() would continue — null before the
   * first turn of a fresh, unsent conversation. Used to detect whether a
   * session the navigator just deleted is the one currently open in chat
   * (see extension.ts's deleteSession wiring), so the chat panel's own
   * persisted-state cache gets invalidated rather than continuing to show a
   * conversation that no longer exists server-side.
   */
  getSessionId(): string | null {
    return this._sessionId;
  }

  /**
   * Ensure a session exists before the first turn of a new conversation —
   * unlike the old /coding/chat, POST /api/v1/chat no longer creates one
   * lazily (it 400s without a session_id). Idempotent: a no-op once
   * _sessionId is set, whether by this call or by setSessionId (session
   * history restore).
   */
  private async _ensureSession(agentUrl: string, token: string): Promise<string | null> {
    if (this._sessionId) {
      return this._sessionId;
    }
    const workspaceId = this.getWorkspaceId();
    if (!workspaceId) {
      return null;
    }
    try {
      const resp = await fetch(`${agentUrl}/api/v1/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({ workspace_id: workspaceId, source: CODING_IDE_SOURCE }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        return null;
      }
      const body = (await resp.json()) as CreateSessionResponse;
      this._sessionId = body.session_id;
      return this._sessionId;
    } catch {
      return null;
    }
  }

  /**
   * Send a user message to the agent and stream the response.
   *
   * The flow:
   * 1. Ensure a session exists (create one via POST /session if this is a
   *    new conversation).
   * 2. POST to /chat with the session id + this one message + ide_context.
   * 3. Stream SSE events back — including, for a CODING-verdict turn,
   *    hermes.tool.deferred events the caller must execute locally and
   *    report back via sendToolResult() WHILE this stream stays open.
   */
  async sendMessage(
    agentUrl: string,
    token: string,
    content: string,
    context: IDEContext,
    onText: TextCallback,
    imageIds?: string[],
  ): Promise<void> {
    await this._streamRequest(agentUrl, token, content, context, onText, imageIds);
  }

  /**
   * Report a deferred tool call's real result back to the agent.
   *
   * Unlike the old /coding/chat flow (resend the full message history as a
   * new HTTP request), this POSTs out-of-band to
   * /coding/sessions/{session_id}/tool-result while the ORIGINAL /chat
   * request from sendMessage() is still open and streaming — that request
   * is blocked server-side on opencode's MCP tool call, which this unblocks.
   * Must NOT touch the SSE stream itself; the caller's existing read loop
   * (still running) picks up whatever comes next (more tool calls, then
   * final text) on its own.
   */
  async sendToolResult(toolCallId: string, result: ToolResultPayload): Promise<void> {
    const token = await this.getToken();
    if (!token || !this._sessionId) {
      return;
    }
    const agentUrl = this.getAgentUrl();
    const body: ToolResultRequest = { call_id: toolCallId, result };

    try {
      const resp = await fetch(
        `${agentUrl}/api/v1/coding/sessions/${this._sessionId}/tool-result`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!resp.ok) {
        this._onError?.(`Failed to report tool result (HTTP ${resp.status}).`);
      }
    } catch (err) {
      this._onError?.(`Failed to report tool result: ${err}`);
    }
  }

  /**
   * Answer a pending clarify prompt (agent.clarify), unblocking the turn.
   *
   * Same "POST out-of-band while the original /chat stream stays open"
   * shape as sendToolResult — the clarify tool blocks server-side the same
   * way a deferred MCP tool call does, just resolved through
   * /threads/{session_id}/clarify instead of the coding-sessions
   * tool-result endpoint (this is the SAME endpoint the browser chat uses;
   * it's session_id-scoped despite the URL, and gated on the caller being
   * whoever triggered the turn — always true here, since the IDE's own
   * identity is what triggered it).
   */
  async answerClarify(clarifyId: string, response: string): Promise<void> {
    const token = await this.getToken();
    if (!token || !this._sessionId) {
      return;
    }
    const agentUrl = this.getAgentUrl();

    try {
      const resp = await fetch(`${agentUrl}/api/v1/threads/${this._sessionId}/clarify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({ clarify_id: clarifyId, response }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok && resp.status !== 404) {
        this._onError?.(`Failed to answer clarify prompt (HTTP ${resp.status}).`);
      }
    } catch (err) {
      this._onError?.(`Failed to answer clarify prompt: ${err}`);
    }
  }

  /**
   * Internal: POST to the SSE endpoint and parse the event stream.
   */
  private async _streamRequest(
    agentUrl: string,
    token: string,
    message: string,
    context: IDEContext,
    onText: TextCallback,
    imageIds?: string[],
  ): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    if (!workspaceId) {
      onText(
        '\n\n⚠️ No workspace found on your account. Run "Actorium: Switch Workspace" or contact your admin.\n',
      );
      return;
    }

    const sessionId = await this._ensureSession(agentUrl, token);
    if (!sessionId) {
      onText('\n\n⚠️ Could not start a chat session. Please try again.\n');
      return;
    }

    this._abortController = new AbortController();

    const request: ChatTurnRequest = {
      session_id: sessionId,
      message,
      workspace_id: workspaceId,
      model: this._model,
      image_ids: imageIds && imageIds.length > 0 ? imageIds : undefined,
      ide_context: context,
    };

    try {
      const response = await fetch(`${agentUrl}/api/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(request),
        signal: this._abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          onText('\n\n⚠️ Authentication expired. Please reconnect.\n');
          return;
        }
        onText(`\n\n⚠️ Error ${response.status}: ${response.statusText}\n`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onText('\n\n⚠️ No response body\n');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      // SSE records pair an optional `event:` line with the `data:` line(s)
      // that follow, up to the next blank line — the event name is NOT part
      // of the JSON payload itself, so it must be tracked across lines.
      let currentEvent: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line === '') {
            currentEvent = undefined;
            continue;
          }

          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data) {
              continue;
            }
            if (data === '[DONE]') {
              currentEvent = undefined;
              continue;
            }

            try {
              const raw = JSON.parse(data) as Record<string, unknown>;
              for (const evt of parseSSEFrame(currentEvent, raw)) {
                switch (evt.kind) {
                  case 'delta':
                    onText(evt.text);
                    break;
                  case 'reasoning':
                    this._onReasoning?.(evt.content);
                    break;
                  case 'reasoningDone':
                    this._onReasoningDone?.();
                    break;
                  case 'toolStart':
                    this._onToolStart?.(evt.callId, evt.name);
                    break;
                  case 'toolDone':
                    this._onToolDone?.(evt.callId, evt.name);
                    break;
                  case 'deferred':
                    this._onDeferred?.({
                      type: 'hermes.tool.deferred',
                      tool_call_id: evt.toolCallId,
                      tool: evt.tool,
                      params: evt.params,
                    });
                    break;
                  case 'clarify':
                    this._onClarify?.(evt.clarifyId, evt.question, evt.choices, evt.multiple);
                    break;
                  case 'error':
                    this._onError?.(evt.message);
                    onText(`\n\n⚠️ ${evt.message}\n`);
                    break;
                }
              }
            } catch {
              // Non-JSON data — handle as raw text chunk
              onText(data);
            }

            currentEvent = undefined;
          }
        }
      }
    } catch (err: unknown) {
      const fetchErr = err as { name?: string };
      if (fetchErr.name === 'AbortError') {
        return; // Intentional abort — not an error
      }
      onText(`\n\n⚠️ Connection error: ${err}\n`);
    } finally {
      this._abortController = null;
    }
  }

  /**
   * Cancel the current streaming request.
   */
  cancel(): void {
    this._abortController?.abort();
  }

  /**
   * Clear the message history and start a fresh conversation (next turn
   * creates a new DB session rather than continuing the old one).
   */
  clearMessages(): void {
    this._sessionId = null;
  }

  /**
   * Dispose the client and cancel any active requests.
   */
  dispose(): void {
    this.cancel();
  }
}
