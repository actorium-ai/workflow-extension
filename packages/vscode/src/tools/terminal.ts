import * as vscode from 'vscode';
import type { ToolResultPayload } from '@workflow-extension/shared';

/**
 * Execute terminal commands using VS Code's integrated terminal API.
 *
 * Creates a terminal, sends the command, and captures output.
 * Note: VS Code terminal API does not provide direct output capture,
 * so we use a pseudo-terminal approach for interactive commands,
 * or exec for simple commands with output capture.
 */
export class TerminalOps {
  /**
   * Run a shell command and return its output.
   *
   * Uses child_process.exec via a hidden terminal approach.
   * For long-running commands, uses a visible terminal with notification.
   */
  async runCommand(command: string, cwd?: string): Promise<ToolResultPayload> {
    try {
      const execPromise = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const cp = require('child_process') as typeof import('child_process');
        cp.exec(
          command,
          {
            cwd: cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            maxBuffer: 1024 * 1024, // 1MB
            timeout: 120_000, // 2 minutes
          },
          (err: Error | null, stdout: string, stderr: string) => {
            if (err) {
              reject(err);
            } else {
              resolve({ stdout, stderr });
            }
          },
        );
      });

      const { stdout, stderr } = await execPromise;

      const output = [stdout, stderr].filter(Boolean).join('\n');
      return {
        ok: true,
        content: output || '(command completed with no output)',
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      const output = [execErr.stdout, execErr.stderr].filter(Boolean).join('\n');
      return {
        ok: false,
        content: output,
        error: execErr.message ?? String(err),
      };
    }
  }

  /**
   * Run a command in a visible VS Code terminal (for interactive use).
   */
  runInTerminal(command: string, name?: string): void {
    const terminal = vscode.window.createTerminal({
      name: name ?? 'Hermes',
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
    terminal.show();
    terminal.sendText(command);
  }
}
