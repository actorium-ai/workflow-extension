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
 * CLI logo assets — Vite's `public/images/cli/*.svg` convention in the
 * vscode-webview package copies these verbatim into `webview/dist/images/cli/`
 * at build time (already inside panel.ts's `localResourceRoots`). A webview
 * can't construct `asWebviewUri` URIs itself, so the extension host resolves
 * them here and hands them to the React app as a global — see
 * utils/cli-icons.ts on the webview side, which must list the same names.
 */
const CLI_ICON_NAMES = ['actorium-mcp', 'claude', 'codex', 'opencode'] as const;

/**
 * Builds the CSP-locked-down HTML shell a webview loads — shared by the
 * Navigator sidebar view and the feature-detail editor-tab panels (both use
 * the same bundle; `initialData.panelKind` tells main.tsx which root
 * component to mount, since a single VS Code extension can't ship one
 * bundle-per-webview-type without a second Vite entry point).
 */
export function buildWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  initialData?: Record<string, unknown>,
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
  const nonce = getNonce();

  const iconsDir = vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist', 'images', 'cli');
  const cliIconUrls = Object.fromEntries(
    CLI_ICON_NAMES.map((name) => [
      name,
      webview.asWebviewUri(vscode.Uri.joinPath(iconsDir, `${name}.svg`)).toString(),
    ]),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: blob: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Actorium</title>
  ${styleUri ? `<link rel="stylesheet" href="${styleUri}">` : ''}
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__ACTORIUM_CLI_ICON_URLS__ = ${JSON.stringify(cliIconUrls)};
    window.__ACTORIUM_INITIAL_DATA__ = ${JSON.stringify(initialData ?? null)};
  </script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
