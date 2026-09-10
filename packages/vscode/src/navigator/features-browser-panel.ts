import type { FeatureSummary } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { buildWebviewHtml } from '../webview-html.js';
import { checkoutHandoffPRs } from '../workspace/handoffCheckout.js';
import { FeatureDetailPanel } from './feature-detail-panel.js';
import { codingApiConfig, type CodingApiContext, getWorkspaceDetail } from './workflow-api.js';

/**
 * Full-workspace Features browser, opened as an editor tab — the "Open all"
 * action next to the sidebar's Features section, for browsing every feature
 * at once rather than the sidebar's cramped stage-grouped list. Mirrors
 * digital-factory-ui's own Features page (read-only here — no "New
 * Feature", matching the rest of this extension's read-only scope).
 * Singleton: reveals the existing panel instead of opening a second one, but
 * always refetches on reveal — the webview's `retainContextWhenHidden: true`
 * means its React app never remounts on repeat-open, so it would otherwise
 * never re-send 'ready' and the panel would show whatever data was current
 * the first time it was ever opened, potentially long stale.
 */
export class FeaturesBrowserPanel {
  private static instance: FeaturesBrowserPanel | null = null;

  private readonly panel: vscode.WebviewPanel;
  private disposed = false;

  static createOrShow(context: vscode.ExtensionContext, codingApiCtx: CodingApiContext): void {
    if (FeaturesBrowserPanel.instance) {
      FeaturesBrowserPanel.instance.panel.reveal();
      void FeaturesBrowserPanel.instance.loadFeatures();
      return;
    }
    FeaturesBrowserPanel.instance = new FeaturesBrowserPanel(context, codingApiCtx);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly codingApiCtx: CodingApiContext,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'actorium.featuresBrowser',
      'Features',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist')],
        retainContextWhenHidden: true,
      },
    );
    this.panel.webview.html = buildWebviewHtml(context, this.panel.webview, {
      panelKind: 'features-browser',
    });

    this.panel.webview.onDidReceiveMessage(
      (message: { command?: string; feature?: FeatureSummary }) => {
        if (message.command === 'ready') void this.loadFeatures();
        if (message.command === 'openFeatureDetail' && message.feature) {
          FeatureDetailPanel.createOrShow(this.context, this.codingApiCtx, message.feature);
        }
        if (message.command === 'checkoutHandoffPRs' && message.feature) {
          void checkoutHandoffPRs(this.context, this.codingApiCtx, message.feature);
        }
      },
    );
    this.panel.onDidDispose(() => {
      this.disposed = true;
      FeaturesBrowserPanel.instance = null;
    });
  }

  /** Fetches the SAME workspace-detail response the sidebar uses — its
   * `features` array is unpaginated (every feature in the workspace, see
   * workflow-backend's ListWorkspaceFeatures), and its `tasks` array (also
   * unpaginated) is reused here to power the List view's per-feature
   * expandable task rows, without a second fetch. */
  private async loadFeatures(): Promise<void> {
    const workspaceId = this.codingApiCtx.getWorkspaceId();
    const detail = workspaceId
      ? await getWorkspaceDetail(codingApiConfig(this.codingApiCtx), workspaceId)
      : null;
    if (this.disposed) return;
    this.postMessage({
      command: 'featuresLoaded',
      features: detail?.features ?? [],
      tasks: detail?.tasks ?? [],
    });
  }

  private postMessage(message: Record<string, unknown>): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }
}
