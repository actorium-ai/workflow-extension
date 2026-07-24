import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import { Navigator } from './navigator';

declare global {
  interface Window {
    __ACTORIUM_VIEW__?: 'chat' | 'navigator';
  }
}

window.addEventListener('error', (e) => {
  const root = document.getElementById('root');
  if (!root || root.childElementCount > 0) return;
  const div = document.createElement('div');
  div.className = 'msg-row assistant';
  div.style.padding = '12px';
  div.textContent = `⚠️ Webview script error: ${e.message || e.error} (${e.filename}:${e.lineno})`;
  root.appendChild(div);
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Actorium webview: #root element not found');

// One bundle serves both the chat webview (secondary sidebar) and the
// navigator webview (primary sidebar) — the extension host injects which one
// this particular webview instance is via window.__ACTORIUM_VIEW__ (see
// packages/vscode/src/webview-html.ts) rather than shipping two Vite entries.
const view = window.__ACTORIUM_VIEW__ ?? 'chat';

createRoot(rootEl).render(
  <StrictMode>{view === 'navigator' ? <Navigator /> : <App />}</StrictMode>,
);
