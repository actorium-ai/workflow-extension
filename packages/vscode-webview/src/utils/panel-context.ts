import type { FeatureSummary } from './types.ts';

export type PanelKind = 'navigator' | 'feature-detail' | 'features-browser' | 'git';

export interface FeatureDetailInitialData {
  panelKind: 'feature-detail';
  feature: FeatureSummary;
}

export interface FeaturesBrowserInitialData {
  panelKind: 'features-browser';
}

export interface GitPanelInitialData {
  panelKind: 'git';
}

type InitialData =
  FeatureDetailInitialData | FeaturesBrowserInitialData | GitPanelInitialData | null;

declare global {
  interface Window {
    /** Injected by the extension host's webview-html.ts — tells main.tsx
     * which root component to mount, since the sidebar Navigator and the
     * feature-detail editor-tab panels share one bundle (see
     * FeatureDetailPanel's doc comment for why). */
    __ACTORIUM_INITIAL_DATA__?: InitialData;
  }
}

/** Returns the panel kind this webview instance was opened as — 'navigator'
 * (the default) when no initial data was injected at all. */
export function getPanelKind(): PanelKind {
  return window.__ACTORIUM_INITIAL_DATA__?.panelKind ?? 'navigator';
}

/** The feature this panel was opened for — only meaningful when
 * getPanelKind() === 'feature-detail'. */
export function getInitialFeature(): FeatureSummary | null {
  const data = window.__ACTORIUM_INITIAL_DATA__;
  return data?.panelKind === 'feature-detail' ? data.feature : null;
}
