import type { IDEContext, IDEFileContext } from '@workflow-extension/shared';
import * as vscode from 'vscode';

/**
 * Gathers IDE context for every message sent to the agent, in the exact
 * shape hermes-agent's IDEContext Pydantic model expects — git_status/
 * diagnostics/selection are pre-formatted text blocks it interpolates
 * directly into the system prompt, not structured data (see shared/types.ts).
 */
export class ContextGatherer {
  /**
   * Gather full IDE context for the current state.
   */
  async gather(): Promise<IDEContext> {
    const editor = vscode.window.activeTextEditor;

    const { branch, status } = await this._getGitStatus();

    return {
      active_file: editor?.document.uri.fsPath ?? '',
      active_file_language: editor?.document.languageId ?? '',
      cursor_line: editor ? editor.selection.active.line + 1 : 0,
      selection: this._getSelection(editor),
      open_files: this._getOpenFiles(),
      git_branch: branch,
      git_status: status,
      diagnostics: this._getDiagnostics(editor),
      workspace_root: this._getWorkspaceRoot(),
    };
  }

  /**
   * Read the content of a specific file.
   */
  async readFile(filePath: string): Promise<string> {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    return doc.getText();
  }

  private _getSelection(editor: vscode.TextEditor | undefined): string | null {
    if (!editor || editor.selection.isEmpty) {
      return null;
    }
    return editor.document.getText(editor.selection);
  }

  private _getOpenFiles(): IDEFileContext[] {
    return vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .map((tab) => {
        const input = tab.input;
        if (input && typeof input === 'object' && 'uri' in input) {
          return (input as { uri: vscode.Uri }).uri.fsPath;
        }
        return null;
      })
      .filter((path): path is string => path !== null)
      .map((path) => ({ path, language: '', cursor_line: 0, selection: null }));
  }

  private _getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return '';
    }
    return folders[0]!.uri.fsPath;
  }

  /**
   * Returns the current branch name and a human-readable status summary
   * (e.g. "Modified: a.ts, b.ts\nUntracked: c.ts") — hermes-agent
   * interpolates both directly into the system prompt as text.
   */
  private async _getGitStatus(): Promise<{ branch: string; status: string }> {
    try {
      const gitExt = vscode.extensions.getExtension('vscode.git');
      if (!gitExt || !gitExt.isActive) {
        return { branch: '', status: '' };
      }

      const gitApi = gitExt.exports.getAPI(1);
      const repo = gitApi.repositories[0];
      if (!repo) {
        return { branch: '', status: '' };
      }

      const state = repo.state;
      const branch: string = state.HEAD?.name ?? '';
      const modified: string[] = state.workingTreeChanges
        .filter((c: { status: number }) => c.status !== 128 /* untracked */)
        .map((c: { uri: { fsPath: string } }) => c.uri.fsPath);
      const staged: string[] = state.indexChanges.map(
        (c: { uri: { fsPath: string } }) => c.uri.fsPath,
      );
      const untracked: string[] = state.workingTreeChanges
        .filter((c: { status: number }) => c.status === 128 /* untracked */)
        .map((c: { uri: { fsPath: string } }) => c.uri.fsPath);

      const lines: string[] = [];
      if (modified.length > 0) lines.push(`Modified: ${modified.join(', ')}`);
      if (staged.length > 0) lines.push(`Staged: ${staged.join(', ')}`);
      if (untracked.length > 0) lines.push(`Untracked: ${untracked.join(', ')}`);

      return { branch, status: lines.join('\n') };
    } catch {
      return { branch: '', status: '' };
    }
  }

  /**
   * Returns a human-readable diagnostics summary for the active file (e.g.
   * "line 45:10 [error] Type 'string' is not assignable to type 'number'") —
   * hermes-agent interpolates this directly into the system prompt as text.
   */
  private _getDiagnostics(editor: vscode.TextEditor | undefined): string {
    if (!editor) {
      return '';
    }

    const diags = vscode.languages.getDiagnostics(editor.document.uri);
    return diags
      .map((d) => {
        const severity = this._severityLabel(d.severity);
        return `line ${d.range.start.line + 1}:${d.range.start.character + 1} [${severity}] ${d.message}`;
      })
      .join('\n');
  }

  private _severityLabel(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return 'error';
      case vscode.DiagnosticSeverity.Warning:
        return 'warning';
      case vscode.DiagnosticSeverity.Information:
        return 'info';
      case vscode.DiagnosticSeverity.Hint:
        return 'hint';
      default:
        return 'info';
    }
  }
}
