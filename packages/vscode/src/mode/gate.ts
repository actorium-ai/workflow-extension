import * as vscode from 'vscode';
import type {
  DeferredToolCall,
  ToolResultPayload,
  OperationalMode,
} from '@workflow-extension/shared';
import type { ToolExecutor } from '../tools/executor.js';

/**
 * Mode gate — enforces Ask/Plan/Auto behaviour for tool execution.
 *
 * Ask:  Show diff card in chat, wait for user approval
 * Plan: Block all mutation tool calls
 * Auto: Execute immediately without approval
 *
 * The `clarify` tool is never blocked — even in Plan mode.
 */
export class ModeGate {
  private _mode: OperationalMode = 'ask';

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
   * Handle a deferred tool call based on the current mode.
   *
   * Returns the result to send back to the agent.
   * In Ask mode, returns a Promise that resolves when the user approves/rejects.
   */
  async handle(
    deferred: DeferredToolCall,
    mode: OperationalMode,
    executor: ToolExecutor,
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
        return this._handleAsk(deferred, executor);

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
   * Ask mode: show a confirmation dialog for mutation tools.
   *
   * For file edits, the diff card is rendered by the webview.
   * Here we show a quick-pick confirmation as the VS Code-native approval UX.
   */
  private async _handleAsk(
    deferred: DeferredToolCall,
    executor: ToolExecutor,
  ): Promise<ToolResultPayload> {
    const isMutation = this._mutationTools.has(deferred.tool);

    if (!isMutation) {
      // Read-only tools execute immediately in Ask mode
      return executor.execute(deferred.tool, deferred.params);
    }

    // Build a human-readable summary of the action
    const summary = this._formatToolSummary(deferred);

    const choice = await vscode.window.showInformationMessage(
      `Hermes wants to ${summary}`,
      { modal: false },
      'Approve',
      'Reject',
    );

    if (choice === 'Approve') {
      return executor.execute(deferred.tool, deferred.params);
    }

    return {
      ok: false,
      applied: false,
      error: 'User rejected the change.',
    };
  }

  /**
   * Format a human-readable summary of the tool call for the approval dialog.
   */
  private _formatToolSummary(deferred: DeferredToolCall): string {
    const params = deferred.params;
    switch (deferred.tool) {
      case 'edit_file':
        return `edit "${params.path}" (${(params as { edits: unknown[] }).edits?.length ?? 0} edit(s))`;
      case 'write_file':
        return `write "${params.path}"`;
      case 'create_directory':
        return `create directory "${params.path}"`;
      case 'run_command':
        return `run: ${(params.command as string)?.substring(0, 80)}`;
      case 'git_commit':
        return `commit: "${params.message}"`;
      case 'git_push':
        return `push to remote`;
      case 'git_checkout':
        return `checkout "${params.ref}"`;
      default:
        return `${deferred.tool}`;
    }
  }
}
