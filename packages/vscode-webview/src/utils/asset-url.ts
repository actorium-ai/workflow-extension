declare global {
  interface Window {
    __WEBVIEW_BASE__?: string;
  }
}

/**
 * Resolves a `public/`-relative asset path (e.g. "/images/foo.svg") against
 * the webview's actual asWebviewUri base — set by panel.ts as a global before
 * the app bundle loads, since only the extension host can compute that URI.
 * Falls back to the plain path under `vite dev` (a real dev server, where
 * relative/absolute paths just work).
 */
export function assetUrl(path: string): string {
  const base = window.__WEBVIEW_BASE__;
  return base ? base + path : path;
}
