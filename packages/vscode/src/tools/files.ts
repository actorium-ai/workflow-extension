import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResultPayload, FileEntry, EditFileParams } from '@workflow-extension/shared';

const execFileAsync = promisify(execFile);

/**
 * Execute file operation tools using VS Code native APIs.
 *
 * All edits go through vscode.WorkspaceEdit for native undo stack support.
 * File creation uses workspace.fs.writeFile and opens the file in an editor tab.
 */
export class FileOps {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * Read a file and return its content.
   */
  async readFile(path: string): Promise<ToolResultPayload> {
    try {
      const fullPath = this._resolvePath(path);
      const uri = vscode.Uri.file(fullPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      return { ok: true, content: doc.getText() };
    } catch (err) {
      return { ok: false, content: '', error: `Failed to read file: ${err}` };
    }
  }

  /**
   * Apply string-replacement edits to a file using WorkspaceEdit (native undo stack).
   */
  async editFile(params: EditFileParams): Promise<ToolResultPayload> {
    try {
      const fullPath = this._resolvePath(params.path);
      const uri = vscode.Uri.file(fullPath);
      const doc = await vscode.workspace.openTextDocument(uri);

      const edit = new vscode.WorkspaceEdit();
      let applied = false;

      for (const op of params.edits) {
        const text = doc.getText();
        const index = text.indexOf(op.old_string);

        if (index === -1) {
          return {
            ok: false,
            applied: false,
            error: `Could not find string: "${op.old_string.substring(0, 80)}..."`,
          };
        }

        const startPos = doc.positionAt(index);
        const endPos = doc.positionAt(index + op.old_string.length);
        const range = new vscode.Range(startPos, endPos);

        edit.replace(uri, range, op.new_string);
        applied = true;
      }

      if (applied) {
        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
          await doc.save();
          return { ok: true, applied: true };
        }
        return { ok: false, applied: false, error: 'WorkspaceEdit.applyEdit returned false' };
      }

      return { ok: false, applied: false, error: 'No edits applied' };
    } catch (err) {
      return { ok: false, applied: false, error: `Failed to edit file: ${err}` };
    }
  }

  /**
   * Create or overwrite a file, and open it in the editor.
   */
  async writeFile(path: string, content: string): Promise<ToolResultPayload> {
    try {
      const fullPath = this._resolvePath(path);
      const uri = vscode.Uri.file(fullPath);

      // Ensure parent directory exists
      const parentDir = uri.with({ path: uri.path.substring(0, uri.path.lastIndexOf('/')) });
      try {
        await vscode.workspace.fs.stat(parentDir);
      } catch {
        await vscode.workspace.fs.createDirectory(parentDir);
      }

      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

      // Open in editor tab
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);

      return { ok: true, applied: true, path };
    } catch (err) {
      return { ok: false, applied: false, error: `Failed to write file: ${err}` };
    }
  }

  /**
   * Create a directory.
   */
  async createDirectory(path: string): Promise<ToolResultPayload> {
    try {
      const fullPath = this._resolvePath(path);
      const uri = vscode.Uri.file(fullPath);
      await vscode.workspace.fs.createDirectory(uri);
      return { ok: true, path };
    } catch (err) {
      return { ok: false, error: `Failed to create directory: ${err}` };
    }
  }

  /**
   * Browse a directory — return list of files and subdirectories.
   */
  async browseDirectory(path: string): Promise<ToolResultPayload> {
    try {
      const fullPath = this._resolvePath(path);
      const uri = vscode.Uri.file(fullPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);

      const files: FileEntry[] = entries.map(([name, fileType]) => ({
        name,
        path: `${path}/${name}`,
        type: fileType === vscode.FileType.Directory ? 'directory' : 'file',
      }));

      // Sort: directories first, then alphabetically
      files.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { ok: true, files };
    } catch (err) {
      return { ok: false, error: `Failed to browse directory: ${err}` };
    }
  }

  /**
   * Search file contents using ripgrep or grep.
   */
  async searchCode(pattern: string, path?: string): Promise<ToolResultPayload> {
    try {
      const searchPath = path ? this._resolvePath(path) : this.workspaceRoot;
      const { stdout } = await execFileAsync(
        'rg',
        ['--no-heading', '--line-number', '-n', pattern, searchPath],
        { timeout: 30000 },
      );

      return { ok: true, content: stdout || '(no matches)' };
    } catch (err: unknown) {
      const execErr = err as { code?: number; stderr?: string };
      if (execErr.code === 1) {
        return { ok: true, content: '(no matches)' };
      }
      return { ok: false, error: `Search failed: ${execErr.stderr ?? err}` };
    }
  }

  /**
   * Search files by glob pattern.
   */
  async searchFiles(pattern: string): Promise<ToolResultPayload> {
    try {
      const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 200);
      const files = uris.map((uri) => uri.fsPath);
      return { ok: true, content: files.join('\n') || '(no matches)' };
    } catch (err) {
      return { ok: false, error: `File search failed: ${err}` };
    }
  }

  /**
   * Resolve a path relative to the workspace root.
   */
  private _resolvePath(relativePath: string): string {
    if (relativePath.startsWith('/')) {
      return relativePath;
    }
    return `${this.workspaceRoot}/${relativePath}`;
  }
}
