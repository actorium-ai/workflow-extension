import type { WebviewApi } from 'vscode-webview';

let cached: WebviewApi<unknown> | null = null;

/** Memoized — acquireVsCodeApi() throws if called more than once per webview. */
export function getVsCodeApi(): WebviewApi<unknown> {
  if (!cached) {
    cached = acquireVsCodeApi();
  }
  return cached;
}
