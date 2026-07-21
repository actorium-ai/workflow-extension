import * as vscode from 'vscode';
import type { IDEContext, GitContext, DiagnosticInfo } from '@workflow-extension/shared';

/**
 * Gathers IDE context for every message sent to the agent.
 * Includes: active file, selection, open files, git status, diagnostics, workspace root.
 */
export class ContextGatherer {
  /**
   * Gather full IDE context for the current state.
   */
  async gather(): Promise<IDEContext> {
    const editor = vscode.window.activeTextEditor;

    const activeFile = editor?.document.uri.fsPath ?? null;
    const selection = this._getSelection(editor);
    const openFiles = this._getOpenFiles();
    const workspaceRoot = this._getWorkspaceRoot();
    const gitStatus = await this._getGitStatus();
    const diagnostics = this._getDiagnostics(editor);

    return {
      active_file: activeFile,
      selection,
      open_files: openFiles,
      workspace_root: workspaceRoot,
      git_status: gitStatus,
      diagnostics,
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

  private _getSelection(editor: vscode.TextEditor | undefined): IDEContext['selection'] {
    if (!editor || editor.selection.isEmpty) {
      return null;
    }

    return {
      start_line: editor.selection.start.line + 1,
      end_line: editor.selection.end.line + 1,
      text: editor.document.getText(editor.selection),
    };
  }

  private _getOpenFiles(): string[] {
    return vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .map((tab) => {
        const input = tab.input;
        if (input && typeof input === 'object' && 'uri' in input) {
          return (input as { uri: vscode.Uri }).uri.fsPath;
        }
        return null;
      })
      .filter((path): path is string => path !== null);
  }

  private _getWorkspaceRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return null;
    }
    return folders[0]!.uri.fsPath;
  }

  private async _getGitStatus(): Promise<GitContext | null> {
    try {
      const gitExt = vscode.extensions.getExtension('vscode.git');
      if (!gitExt || !gitExt.isActive) {
        return null;
      }

      const gitApi = gitExt.exports.getAPI(1);
      const repo = gitApi.repositories[0];
      if (!repo) {
        return null;
      }

      const state = repo.state;
      return {
        branch: state.HEAD?.name ?? null,
        modified: state.workingTreeChanges.map((c: { uri: { fsPath: string } }) => c.uri.fsPath),
        staged: state.indexChanges.map((c: { uri: { fsPath: string } }) => c.uri.fsPath),
        untracked: state.workingTreeChanges
          .filter((c: { status: number }) => c.status === 128 /* untracked */)
          .map((c: { uri: { fsPath: string } }) => c.uri.fsPath),
        remote_url: state.remotes[0]?.fetchUrl ?? null,
      };
    } catch {
      return null;
    }
  }

  private _getDiagnostics(editor: vscode.TextEditor | undefined): DiagnosticInfo[] {
    if (!editor) {
      return [];
    }

    const diags = vscode.languages.getDiagnostics(editor.document.uri);
    return diags.map((d) => ({
      file: editor.document.uri.fsPath,
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
      severity: this._mapSeverity(d.severity),
      message: d.message,
    }));
  }

  private _mapSeverity(severity: vscode.DiagnosticSeverity): DiagnosticInfo['severity'] {
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
