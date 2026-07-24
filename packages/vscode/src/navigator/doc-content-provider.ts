import * as vscode from 'vscode';

export const ACTORIUM_DOC_SCHEME = 'actorium-doc';

/**
 * Read-only virtual document provider for workspace docs with no local
 * checkout (see NavigatorPanelProvider._openDocument's remote-content
 * fallback). Content lives only in memory, fed to VS Code through this
 * provider rather than an untitled scratch buffer — an untitled document is
 * always "dirty" the moment it has content and prompts to save on close;
 * a registered-scheme virtual document (same mechanism the Git/Output views
 * use for diffs and logs) never is, since VS Code has nothing to save it as.
 */
export class DocContentProvider implements vscode.TextDocumentContentProvider {
  private readonly _contents = new Map<string, string>();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  set(uri: vscode.Uri, content: string): void {
    this._contents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._contents.get(uri.toString()) ?? '';
  }
}
