import type {
  ApprovalChoice,
  DeferredToolCall,
  OperationalMode,
  ToolResultPayload,
} from '@workflow-extension/shared';

import type { ToolExecutor } from '../tools/executor.js';

/** Resolved by the webview's inline approval card (see ChatPanelProvider.showApproval /
 * extension.ts's onAnswerApproval wiring) — the extension-host-internal analogue of
 * clarify's server-side wait, since Ask-mode enforcement never leaves the client. */
export type RequestApproval = (
  callId: string,
  tool: string,
  params: Record<string, unknown>,
) => Promise<{ choice: ApprovalChoice; instructions?: string }>;

/**
 * Mode gate — enforces Ask/Plan/Auto behaviour for tool execution.
 *
 * Ask:  Show an inline approval card in chat, wait for user response
 * Plan: Block all mutation tool calls
 * Auto: Execute immediately without approval
 *
 * The `clarify` tool is never blocked — even in Plan mode.
 */
export class ModeGate {
  private _mode: OperationalMode = 'ask';

  // "Yes, allow all edits this session" — bypasses Ask-mode prompting for
  // mutation tools until the chat is cleared (see resetSessionApproval).
  private _autoApproveSession = false;

  // Tool categories
  private readonly _mutationTools = new Set([
    'edit_file',
    'write_file',
    'create_directory',
    'run_command',
    'git_commit',
    'git_push',
    'git_checkout',
  ]);

  /**
   * Get the current operational mode.
   */
  getMode(): OperationalMode {
    return this._mode;
  }

  /**
   * Set the operational mode.
   */
  setMode(mode: OperationalMode): void {
    this._mode = mode;
  }

  /**
   * Clear the "allow all edits this session" grant — called on New Chat,
   * since the grant is scoped to a single conversation, not global.
   */
  resetSessionApproval(): void {
    this._autoApproveSession = false;
  }

  /**
   * Handle a deferred tool call based on the current mode.
   *
   * Returns the result to send back to the agent.
   * In Ask mode, returns a Promise that resolves when the user responds to
   * the inline approval card.
   */
  async handle(
    deferred: DeferredToolCall,
    mode: OperationalMode,
    executor: ToolExecutor,
    requestApproval: RequestApproval,
  ): Promise<ToolResultPayload> {
    // `clarify` is always allowed regardless of mode
    if (deferred.tool === 'clarify') {
      return {
        ok: true,
        applied: true,
        content: `Question: ${JSON.stringify(deferred.params)}`,
      };
    }

    switch (mode) {
      case 'auto':
        return executor.execute(deferred.tool, deferred.params);

      case 'ask':
        return this._handleAsk(deferred, executor, requestApproval);

      case 'plan':
        return this._handlePlan(deferred);

      default:
        return { ok: false, error: `Unknown mode: ${mode}` };
    }
  }

  /**
   * Plan mode: block all mutation tools, allow reads.
   */
  private async _handlePlan(deferred: DeferredToolCall): Promise<ToolResultPayload> {
    if (this._mutationTools.has(deferred.tool)) {
      return {
        ok: false,
        applied: false,
        error: `Plan mode: tool "${deferred.tool}" is blocked. Switch to Ask or Auto mode to execute changes.`,
      };
    }

    // Read-only tools are allowed in Plan mode — but we don't execute
    // because the tool executor isn't wired for read-only in this context.
    // The agent gets read results from the context gatherer at request time.
    return {
      ok: true,
      content: `[Plan mode] Tool "${deferred.tool}" would execute with params: ${JSON.stringify(deferred.params)}`,
    };
  }

  /**
   * Ask mode: show an inline approval card (in chat) for mutation tools and
   * wait for the user's response.
   */
  private async _handleAsk(
    deferred: DeferredToolCall,
    executor: ToolExecutor,
    requestApproval: RequestApproval,
  ): Promise<ToolResultPayload> {
    const isMutation = this._mutationTools.has(deferred.tool);

    if (!isMutation) {
      // Read-only tools execute immediately in Ask mode
      return executor.execute(deferred.tool, deferred.params);
    }

    if (this._autoApproveSession) {
      return executor.execute(deferred.tool, deferred.params);
    }

    const { choice, instructions } = await requestApproval(
      deferred.tool_call_id,
      deferred.tool,
      deferred.params,
    );

    if (choice === 'yes_all') {
      this._autoApproveSession = true;
      return executor.execute(deferred.tool, deferred.params);
    }

    if (choice === 'yes') {
      return executor.execute(deferred.tool, deferred.params);
    }

    if (choice === 'instructions' && instructions) {
      return {
        ok: false,
        applied: false,
        error: `User rejected this change and asked for something different instead: ${instructions}`,
      };
    }

    return {
      ok: false,
      applied: false,
      error: 'User rejected the change.',
    };
  }
}
