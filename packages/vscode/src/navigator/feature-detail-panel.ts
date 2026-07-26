import type { FeatureSummary } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { buildWebviewHtml } from '../webview-html.js';
import {
  codingApiConfig,
  type CodingApiContext,
  getDocumentContent,
  getFeatureActivity,
  getFeatureHandoff,
  getFeatureTasks,
  getTaskDetail,
  getTaskDiffContent,
} from './workflow-api.js';

const CANONICAL_DOCS = [
  { key: 'product_spec', filename: 'product_spec.md' },
  { key: 'tech_design', filename: 'tech_design.md' },
] as const;

/**
 * One editor-tab webview panel per open feature — Product Spec/Tech
 * Design/Tasks/Handoff/Activity tabs, mirroring digital-factory-ui's own
 * feature detail page. Opened by clicking a feature in the Navigator
 * sidebar's Features list (see feature-list.tsx's onOpenFeatureDetail).
 * Reuses the same webview bundle as the sidebar Navigator — see
 * webview-html.ts's `initialData.panelKind`, since a single VS Code
 * extension can't cheaply ship a bundle-per-webview-type.
 */
export class FeatureDetailPanel {
  private static readonly panels = new Map<string, FeatureDetailPanel>();

  private readonly panel: vscode.WebviewPanel;
  private disposed = false;

  static createOrShow(
    context: vscode.ExtensionContext,
    codingApiCtx: CodingApiContext,
    feature: FeatureSummary,
  ): void {
    const existing = FeatureDetailPanel.panels.get(feature.id);
    if (existing) {
      existing.panel.reveal();
      // retainContextWhenHidden keeps the webview's React app alive across
      // reveals, so it never re-sends 'ready' on repeat-open — refetch
      // explicitly here instead of relying on that, or this panel would show
      // stale data indefinitely once left open.
      void existing.loadAll();
      return;
    }
    FeatureDetailPanel.panels.set(
      feature.id,
      new FeatureDetailPanel(context, codingApiCtx, feature),
    );
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly codingApiCtx: CodingApiContext,
    private readonly feature: FeatureSummary,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'actorium.featureDetail',
      feature.feature_name || feature.title || feature.id,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist')],
        retainContextWhenHidden: true,
      },
    );
    this.panel.webview.html = buildWebviewHtml(context, this.panel.webview, {
      panelKind: 'feature-detail',
      feature,
    });

    this.panel.webview.onDidReceiveMessage(
      (message: { command?: string; taskId?: string; repo?: string; url?: string }) => {
        if (message.command === 'ready') void this.loadAll();
        else if (message.command === 'openTask' && message.taskId)
          void this.loadTaskDetail(message.taskId);
        else if (message.command === 'loadTaskDiff' && message.taskId)
          void this.loadTaskDiff(message.taskId, message.repo ?? '');
        else if (message.command === 'openExternalUrl' && message.url)
          void vscode.env.openExternal(vscode.Uri.parse(message.url));
      },
    );
    this.panel.onDidDispose(() => {
      this.disposed = true;
      FeatureDetailPanel.panels.delete(this.feature.id);
    });
  }

  /** Fetches the Product Spec/Tech Design docs, the structured task list,
   * the handoff PR table, and the activity feed for this feature, and sends
   * them to the webview in one message once all requests settle — no
   * per-tab lazy loading for these, since they're all small enough to fetch
   * eagerly. Per-task detail/diff (potentially large) are fetched on demand
   * instead — see loadTaskDetail/loadTaskDiff below. */
  private async loadAll(): Promise<void> {
    const workspaceId = this.codingApiCtx.getWorkspaceId();
    if (!workspaceId) return;
    const config = codingApiConfig(this.codingApiCtx);

    const [docs, tasks, handoff, activity] = await Promise.all([
      Promise.all(
        CANONICAL_DOCS.map(async ({ key, filename }) => ({
          key,
          content: await getDocumentContent(config, workspaceId, {
            path: filename,
            feature_id: this.feature.id,
          }),
        })),
      ),
      getFeatureTasks(config, workspaceId, this.feature.id),
      getFeatureHandoff(config, workspaceId, this.feature.id),
      getFeatureActivity(config, workspaceId, this.feature.id),
    ]);

    if (this.disposed) return;
    const docsByKey: Record<string, string | null> = {};
    for (const d of docs) docsByKey[d.key] = d.content;

    this.postMessage({
      command: 'featureDetailLoaded',
      docs: docsByKey,
      tasks: tasks ?? [],
      handoff: handoff ?? null,
      activity: activity ?? [],
    });
  }

  private async loadTaskDetail(taskId: string): Promise<void> {
    const workspaceId = this.codingApiCtx.getWorkspaceId();
    if (!workspaceId) return;
    const config = codingApiConfig(this.codingApiCtx);
    const detail = await getTaskDetail(config, workspaceId, this.feature.id, taskId);
    if (this.disposed) return;
    this.postMessage({ command: 'taskDetailLoaded', taskId, detail });
  }

  private async loadTaskDiff(taskId: string, repo: string): Promise<void> {
    const workspaceId = this.codingApiCtx.getWorkspaceId();
    if (!workspaceId) return;
    const config = codingApiConfig(this.codingApiCtx);
    const diff = await getTaskDiffContent(config, workspaceId, taskId, repo);
    if (this.disposed) return;
    this.postMessage({ command: 'taskDiffLoaded', taskId, diff });
  }

  private postMessage(message: Record<string, unknown>): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }
}
