import type {
  CodingChatRequest,
  ChatMessage,
  IDEContext,
  OperationalMode,
  DeferredToolCall,
  ToolResultPayload,
  CreditInfo,
} from '@workflow-extension/shared';

export type TextCallback = (text: string) => void;
export type DeferredCallback = (deferred: DeferredToolCall) => void;
export type ProgressCallback = (toolCallId: string, status: string) => void;
export type CostCallback = (info: CreditInfo) => void;

/**
 * SSE client for the hermes-agent coding chat endpoint.
 *
 * Sends POST /api/v1/coding/chat with SSE streaming response.
 * Parses SSE events: chat.completion.chunk, hermes.tool.deferred,
 * hermes.tool.progress, cost, done, error.
 */
export class SseClient {
  private _messages: ChatMessage[] = [];
  private _abortController: AbortController | null = null;
  private _onText: TextCallback | null = null;
  private _onDeferred: DeferredCallback | null = null;
  private _onProgress: ProgressCallback | null = null;
  private _onCost: CostCallback | null = null;

  constructor(
    private readonly getToken: () => Promise<string | null>,
    private readonly getAgentUrl: () => string,
  ) {}

  /**
   * Register a callback for streaming text chunks.
   */
  onText(callback: TextCallback): void {
    this._onText = callback;
  }

  /**
   * Register a callback for deferred tool calls.
   */
  onDeferredToolCall(callback: DeferredCallback): void {
    this._onDeferred = callback;
  }

  /**
   * Register a callback for tool progress events.
   */
  onProgress(callback: ProgressCallback): void {
    this._onProgress = callback;
  }

  /**
   * Register a callback for cost/credit events.
   */
  onCost(callback: CostCallback): void {
    this._onCost = callback;
  }

  /**
   * Send a user message to the agent and stream the response.
   *
   * The flow:
   * 1. Append user message to local message store
   * 2. POST to /coding/chat with full message history + context
   * 3. Stream SSE events back
   * 4. When a deferred tool call arrives, the caller executes it and calls sendToolResult()
   * 5. sendToolResult() appends the result and re-sends the request
   */
  async sendMessage(
    agentUrl: string,
    token: string,
    content: string,
    context: IDEContext,
    mode: OperationalMode,
    onText: TextCallback,
  ): Promise<void> {
    // Append user message
    this._messages.push({ role: 'user', content });

    await this._streamRequest(agentUrl, token, context, mode, onText);
  }

  /**
   * Send a tool result back to the agent and continue the stream.
   *
   * Called after the extension executes a deferred tool call.
   */
  async sendToolResult(toolCallId: string, tool: string, result: ToolResultPayload): Promise<void> {
    const token = await this.getToken();
    const agentUrl = this.getAgentUrl();

    if (!token) {
      return;
    }

    // Append tool result
    this._messages.push({
      role: 'tool',
      content: JSON.stringify(result),
      tool_call_id: toolCallId,
      name: tool,
    });

    const context: IDEContext = {
      active_file: null,
      selection: null,
      open_files: [],
      workspace_root: null,
      git_status: null,
      diagnostics: [],
    };

    await this._streamRequest(agentUrl, token, context, 'auto', (_text) => {
      // Tool results are streamed inline
    });
  }

  /**
   * Internal: POST to the SSE endpoint and parse the event stream.
   */
  private async _streamRequest(
    agentUrl: string,
    token: string,
    context: IDEContext,
    mode: OperationalMode,
    onText: TextCallback,
  ): Promise<void> {
    this._abortController = new AbortController();

    const request: CodingChatRequest = {
      messages: this._messages,
      workspace_id: null,
      feature_id: null,
      repo_path: context.workspace_root,
      context,
      mode,
    };

    try {
      const response = await fetch(`${agentUrl}/api/v1/coding/chat`, {
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
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            // Store event type for the next data line
            // (handled inline in the data processing)
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'chat.completion.chunk') {
                assistantContent += parsed.content ?? '';
                onText(parsed.content ?? '');
              } else if (parsed.type === 'hermes.tool.deferred') {
                // Flush accumulated text first
                if (assistantContent) {
                  this._messages.push({
                    role: 'assistant',
                    content: assistantContent,
                  });
                  assistantContent = '';
                }
                // Push a placeholder assistant message for the tool call
                this._messages.push({
                  role: 'assistant',
                  content: null,
                  tool_call_id: parsed.tool_call_id,
                  name: parsed.tool,
                });
                this._onDeferred?.(parsed as DeferredToolCall);
              } else if (parsed.type === 'hermes.tool.progress') {
                this._onProgress?.(parsed.tool_call_id, parsed.status);
              } else if (parsed.type === 'cost') {
                this._onCost?.(parsed.data as CreditInfo);
              } else if (parsed.type === 'error') {
                onText(`\n\n⚠️ ${parsed.error}\n`);
              }
            } catch {
              // Non-JSON data — handle as raw text chunk
              onText(data);
              assistantContent += data;
            }
          }
        }
      }

      // Flush any remaining text
      if (assistantContent) {
        this._messages.push({
          role: 'assistant',
          content: assistantContent,
        });
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
   * Clear the message history.
   */
  clearMessages(): void {
    this._messages = [];
  }

  /**
   * Dispose the client and cancel any active requests.
   */
  dispose(): void {
    this.cancel();
  }
}
