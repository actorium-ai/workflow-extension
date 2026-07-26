import * as os from 'node:os';
import * as nodePath from 'node:path';

import type { StorageDocument } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { ACTORIUM_DOC_SCHEME, DocContentProvider } from './doc-content-provider.js';
import {
  codingApiConfig,
  type CodingApiContext,
  getDocumentContent,
  getDocumentRaw,
} from './workflow-api.js';

const TEXT_EXTENSION_RE =
  /\.(md|mdx|txt|json|ya?ml|log|csv|toml|ini|conf|sh|js|jsx|ts|tsx|go|py|rb|rs|java|c|cpp|h|hpp|css|html|xml|sql)$/i;

/**
 * Opens a workspace document in a VS Code editor tab. Tries the local
 * checkout first — `doc.path` is workspace-relative, and feature docs
 * written by the coding agent DO sync into the repo under
 * docs/features/<slug>/... (same convention panel.ts's '#' mention fallback
 * relies on for its local *.md search) — but many workspace documents (e.g.
 * per-service DB migration changelogs under database/*, or docs from a
 * feature/repo this IDE window doesn't have checked out) have no local
 * counterpart at all, so a miss falls back to storage-service.
 *
 * The remote fallback tries getDocumentContent first — the ONLY correct way
 * to read a canonical feature doc (product_spec.md/tech_design.md/
 * tasks.md/handoff.md) as text, since those are stored as ProseMirror JSON
 * and storage-service converts them to real markdown for this endpoint (see
 * coding-api.ts). It returns null for anything it can't decode that way
 * (plain uploaded files, binary, etc.), which falls back to getDocumentRaw —
 * the actual stored bytes + content-type, correct for everything else
 * including images.
 *
 * Used by NavigatorPanelProvider's Docs sidebar.
 */
export async function openWorkspaceDocument(
  doc: StorageDocument,
  codingApiCtx: CodingApiContext,
  docContentProvider: DocContentProvider,
): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (root) {
    try {
      const uri = vscode.Uri.joinPath(root.uri, doc.path);
      const textDoc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(textDoc, { preview: true });
      return;
    } catch {
      // No local copy — fall through to the remote-content fetch below.
    }
  }

  const workspaceId = codingApiCtx.getWorkspaceId();
  if (!workspaceId) {
    vscode.window.showErrorMessage(`Actorium: Could not load "${doc.path}".`);
    return;
  }
  const config = codingApiConfig(codingApiCtx);

  const content = await getDocumentContent(config, workspaceId, doc);
  if (content !== null) {
    await showVirtualTextDocument(doc, content, docContentProvider);
    return;
  }

  const raw = await getDocumentRaw(config, workspaceId, doc);
  if (!raw) {
    vscode.window.showErrorMessage(`Actorium: Could not load "${doc.path}".`);
    return;
  }

  const basename = doc.path.split('/').pop() ?? doc.path;
  const isText = raw.contentType.startsWith('text/') || TEXT_EXTENSION_RE.test(basename);
  if (isText) {
    await showVirtualTextDocument(
      doc,
      new TextDecoder('utf-8').decode(raw.data),
      docContentProvider,
    );
    return;
  }

  // Binary (images, etc.) — no read-only-virtual-document equivalent, so
  // stage to a temp file and let VS Code's own native viewer (image
  // preview, etc.) handle it; a real file on disk also means no save
  // prompt (there's simply nothing "dirty" about it).
  const tempPath = nodePath.join(os.tmpdir(), `actorium-${doc.id}-${basename}`);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(tempPath), new Uint8Array(raw.data));
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(tempPath));
}

/** Shows `content` as a read-only virtual document (see DocContentProvider —
 * never prompts to save, unlike an untitled scratch buffer). `query`
 * disambiguates same-named docs (every feature has a tasks.md) from sharing
 * one virtual document, while the clean `path` component keeps the tab's
 * displayed filename readable. */
async function showVirtualTextDocument(
  doc: StorageDocument,
  content: string,
  docContentProvider: DocContentProvider,
): Promise<void> {
  const basename = doc.path.split('/').pop() ?? doc.path;
  const uri = vscode.Uri.from({
    scheme: ACTORIUM_DOC_SCHEME,
    path: `/${basename}`,
    query: doc.id,
  });
  docContentProvider.set(uri, content);
  const textDoc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(textDoc, { preview: true });
}
