import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { FeatureDetail } from './feature-detail';
import { FeaturesBrowser } from './features-browser';
import { Navigator } from './navigator';
import { getPanelKind } from './utils/panel-context.ts';

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

// One bundle, several possible roots — the extension host tells us which one
// via window.__ACTORIUM_INITIAL_DATA__ (see webview-html.ts/panel-context.ts):
// the sidebar Navigator (default), a feature-detail editor-tab panel, or the
// full-workspace Features browser panel.
const PANEL_ROOTS = {
  navigator: Navigator,
  'feature-detail': FeatureDetail,
  'features-browser': FeaturesBrowser,
} as const;
const App = PANEL_ROOTS[getPanelKind()];

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
