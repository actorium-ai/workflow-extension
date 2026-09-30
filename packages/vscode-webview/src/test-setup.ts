// Stub the webview host API the runtime injects into `window` — jsdom has no
// such global, and features-browser.tsx calls acquireVsCodeApi() once at
// module load time (getVsCodeApi() is memoized), so this must run before any
// module under test is imported.
(globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => undefined,
  setState: () => undefined,
});
