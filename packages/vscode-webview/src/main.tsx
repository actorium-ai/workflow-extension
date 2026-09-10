import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { FeatureDetail } from './feature-detail';
import { FeaturesBrowser } from './features-browser';
import { GitPanel } from './git-panel.tsx';
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
  git: GitPanel,
} as const;
const panelKind = getPanelKind();
const App = PANEL_ROOTS[panelKind];
// Distinguishes the sidebar Navigator from the feature-detail/features-browser
// editor-tab panels for styles.css — they share one bundle/stylesheet, but the
// sidebar should match VS Code's sideBar chrome while an editor-tab panel
// should match the editor background, and those two vscode-* tokens differ in
// most themes (see styles.css's --color-bg).
document.body.dataset.panelKind = panelKind;

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
