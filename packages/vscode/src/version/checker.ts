import * as vscode from 'vscode';
import type { VersionInfo, VersionEntry } from '@workflow-extension/shared';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const NUDGE_SUPPRESS_KEY = 'hermes.versionNudgeSuppressedUntil';

/**
 * Version checker — polls GET /api/v1/coding/version on activation and
 * every 6 hours. Enforces min_version (hard block) and recommended_version
 * (soft nudge with 24h suppress).
 */
export class VersionChecker {
  private _interval: NodeJS.Timeout | null = null;
  private readonly EXTENSION_VERSION: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.EXTENSION_VERSION = context.extension.packageJSON?.version ?? '0.1.0';
  }

  /**
   * Begin periodic version checks.
   */
  autoCheck(): void {
    this.checkNow();
    this._interval = setInterval(() => this.checkNow(), CHECK_INTERVAL_MS);
  }

  /**
   * Check the version endpoint immediately.
   */
  async checkNow(): Promise<void> {
    const config = vscode.workspace.getConfiguration('hermes');
    const agentUrl = config.get<string>('agentUrl') ?? '';

    if (!agentUrl) {
      return;
    }

    try {
      const resp = await fetch(`${agentUrl}/api/v1/coding/version`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        console.warn(`[hermes] Version check returned ${resp.status}`);
        return;
      }

      const versionInfo = (await resp.json()) as VersionInfo;
      this._evaluate(versionInfo.vscode);
    } catch (err) {
      // Fail-open on network errors — just log and continue
      console.warn('[hermes] Version check failed (fail-open):', err);
    }
  }

  /**
   * Evaluate the version entry from the backend:
   * - Hard block if installed < min_version
   * - Soft nudge if installed < recommended_version
   */
  private _evaluate(vscEntry: VersionEntry): void {
    const installed = this.EXTENSION_VERSION;

    // Hard block
    if (this._compareVersions(installed, vscEntry.min_version) < 0) {
      this._showBlockingBanner(vscEntry);
      return;
    }

    // Soft nudge (check suppression)
    const suppressed = this.context.globalState.get<number>(NUDGE_SUPPRESS_KEY);
    if (suppressed && Date.now() < suppressed) {
      return; // Still suppressed
    }

    if (this._compareVersions(installed, vscEntry.recommended_version) < 0) {
      this._showUpdateNudge(vscEntry);
    }
  }

  /**
   * Show a blocking banner — chat is disabled until update.
   */
  private async _showBlockingBanner(vscEntry: VersionEntry): Promise<void> {
    const action = await vscode.window.showErrorMessage(
      `Hermes: This extension version (${this.EXTENSION_VERSION}) is no longer compatible with the backend (min: ${vscEntry.min_version}). Update to continue.`,
      { modal: false },
      'Update',
    );

    if (action === 'Update') {
      vscode.env.openExternal(vscode.Uri.parse(vscEntry.marketplace_url));
    }

    // Disable chat
    vscode.commands.executeCommand('setContext', 'hermes.versionBlocked', true);
  }

  /**
   * Show a non-blocking update nudge.
   */
  private async _showUpdateNudge(vscEntry: VersionEntry): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      `Hermes v${vscEntry.recommended_version} is available (you have ${this.EXTENSION_VERSION}).`,
      'Update Now',
      'Later',
    );

    if (action === 'Update Now') {
      vscode.env.openExternal(vscode.Uri.parse(vscEntry.marketplace_url));
    } else if (action === 'Later') {
      // Suppress for 24 hours
      const until = Date.now() + 24 * 60 * 60 * 1000;
      await this.context.globalState.update(NUDGE_SUPPRESS_KEY, until);
    }
  }

  /**
   * Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
   */
  private _compareVersions(a: string, b: string): number {
    const parse = (v: string) => v.split('.').map(Number);
    const partsA = parse(a);
    const partsB = parse(b);

    for (let i = 0; i < 3; i++) {
      const na = partsA[i] ?? 0;
      const nb = partsB[i] ?? 0;
      if (na < nb) return -1;
      if (na > nb) return 1;
    }
    return 0;
  }

  /**
   * Stop periodic checks.
   */
  dispose(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}
