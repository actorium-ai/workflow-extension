import * as fs from 'node:fs';

import * as vscode from 'vscode';

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Builds the CSP-locked-down HTML shell both the chat and navigator webviews
 * load — same built React bundle (@workflow-extension/vscode-webview) for
 * both, branching at runtime on `window.__ACTORIUM_VIEW__` (see main.tsx)
 * rather than shipping two separate Vite entry points.
 */
export function buildWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  view: 'chat' | 'navigator',
): string {
  const assetsDir = vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist', 'assets');
  let files: string[];
  try {
    files = fs.readdirSync(assetsDir.fsPath);
  } catch {
    throw new Error(
      'Actorium: webview bundle not found — run `pnpm --filter @workflow-extension/vscode-webview run build` ' +
        '(or the top-level `pnpm run build`) before launching the extension.',
    );
  }
  const jsFile = files.find((f) => f.endsWith('.js'));
  const cssFile = files.find((f) => f.endsWith('.css'));
  if (!jsFile) {
    throw new Error(
      'Actorium: webview bundle not found — run `pnpm --filter @workflow-extension/vscode-webview run build` ' +
        '(or the top-level `pnpm run build`) before launching the extension.',
    );
  }

  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsDir, jsFile));
  const styleUri = cssFile ? webview.asWebviewUri(vscode.Uri.joinPath(assetsDir, cssFile)) : null;
  // Static assets under public/ (e.g. model-provider icons) are copied by
  // Vite into webview/dist as-is and referenced at runtime via assetUrl()
  // (src/asset-url.ts) — the webview's JS can't call asWebviewUri itself
  // (that API only exists here, in the extension host), so this base URI
  // is handed over as a global instead.
  const webviewBaseUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist'),
  );
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Actorium ${view === 'chat' ? 'Chat' : 'Navigator'}</title>
  ${styleUri ? `<link rel="stylesheet" href="${styleUri}">` : ''}
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__WEBVIEW_BASE__ = ${JSON.stringify(webviewBaseUri.toString())};
    window.__ACTORIUM_VIEW__ = ${JSON.stringify(view)};
  </script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
