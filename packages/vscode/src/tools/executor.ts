import * as vscode from 'vscode';
import { FileOps } from './files.js';
import { TerminalOps } from './terminal.js';
import { GitOps } from './git.js';
import type { ToolResultPayload, EditFileParams } from '@workflow-extension/shared';

/**
 * Routes deferred tool calls from the agent to the correct executor.
 *
 * Each tool handler receives the params from the agent and returns a ToolResultPayload.
 * The SSE client sends this result back to the agent for the next turn.
 */
export class ToolExecutor {
  private fileOps: FileOps;
  private terminalOps: TerminalOps;
  private gitOps: GitOps;

  constructor() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '/';
    this.fileOps = new FileOps(workspaceRoot);
    this.terminalOps = new TerminalOps();
    this.gitOps = new GitOps();
  }

  /**
   * Execute a tool call by name.
   *
   * Returns the result payload to be sent back to the agent.
   */
  async execute(tool: string, params: Record<string, unknown>): Promise<ToolResultPayload> {
    switch (tool) {
      // ── File operations ──────────────────────────────────────────────
      case 'read_file':
        return this.fileOps.readFile(params.path as string);

      case 'edit_file':
        return this.fileOps.editFile(params as unknown as EditFileParams);

      case 'write_file':
        return this.fileOps.writeFile(params.path as string, params.content as string);

      case 'create_directory':
        return this.fileOps.createDirectory(params.path as string);

      case 'browse_directory':
        return this.fileOps.browseDirectory(params.path as string);

      case 'search_code':
        return this.fileOps.searchCode(params.pattern as string, params.path as string | undefined);

      case 'search_files':
        return this.fileOps.searchFiles(params.pattern as string);

      // ── Terminal operations ──────────────────────────────────────────
      case 'run_command':
        return this.terminalOps.runCommand(
          params.command as string,
          params.cwd as string | undefined,
        );

      // ── Git operations ───────────────────────────────────────────────
      case 'git_status':
        return this.gitOps.gitStatus();

      case 'git_diff':
        return this.gitOps.gitDiff();

      case 'git_commit':
        return this.gitOps.gitCommit(params.message as string);

      case 'git_push':
        return this.gitOps.gitPush(params.branch as string | undefined);

      case 'git_checkout':
        return this.gitOps.gitCheckout(params.ref as string);

      case 'git_log':
        return this.gitOps.gitLog((params.max_entries as number) ?? 20);

      // ── Unknown tool ─────────────────────────────────────────────────
      default:
        return {
          ok: false,
          error: `Unknown tool: ${tool}`,
        };
    }
  }
}
