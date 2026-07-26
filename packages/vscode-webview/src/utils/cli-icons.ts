export type CliIconName = 'actorium-mcp' | 'claude' | 'codex' | 'opencode';

declare global {
  interface Window {
    /** Injected by the extension host's webview-html.ts — a webview can't
     * construct `asWebviewUri` URIs itself, so these are resolved there and
     * handed off as a plain global before the app bundle loads. */
    __ACTORIUM_CLI_ICON_URLS__?: Partial<Record<CliIconName, string>>;
  }
}

/** Returns the webview-resource URL for a CLI logo (see
 * public/images/cli/*.svg and webview-html.ts), or undefined if the host
 * hasn't injected it (e.g. running outside the extension host in a test). */
export function getCliIconUrl(name: CliIconName): string | undefined {
  return window.__ACTORIUM_CLI_ICON_URLS__?.[name];
}
