import type { McpVersionEntry, VersionEntry, VersionInfo } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { getActoriumConfig } from '../config/environment.js';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const NUDGE_SUPPRESS_KEY = 'actorium.versionNudgeSuppressedUntil';

/**
 * Compares two dotted-numeric version strings. Returns -1 if a < b, 0 if
 * equal, 1 if a > b. Shared by VersionChecker (extension self-check) and the
 * Navigator panel's actorium-mcp CLI version check — both need the exact
 * same "is installed below this threshold" comparison.
 */
export function compareVersions(a: string, b: string): number {
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
 * Version checker — polls GET /extension/version on activation and every
 * 6 hours. Enforces min_version (hard block) and recommended_version (soft
 * nudge with 24h suppress).
 *
 * This is a BFF-native, unauthenticated endpoint (workflow-bff's
 * internal/app/api/handler/extensionversion) — not hermes-agent, and not
 * behind the /bff/<service> proxy prefix agentUrl uses, since it's public
 * and called before the developer has even logged in.
 */
export class VersionChecker {
  private _interval: NodeJS.Timeout | null = null;
  private readonly EXTENSION_VERSION: string;
  private _onBlocked: ((entry: VersionEntry) => void) | null = null;
  private _blockedEntry: VersionEntry | null = null;
  private _actoriumMcpEntry: McpVersionEntry | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.EXTENSION_VERSION = context.extension.packageJSON?.version ?? '0.1.0';
  }

  /**
   * Registers a callback fired whenever a hard version block is detected
   * (installed < min_version) — drives the Navigator webview's own
   * persistent, non-dismissible block overlay (see
   * NavigatorPanelProvider.setVersionBlocked), separate from the native
   * showErrorMessage notification below (which a user can just dismiss and
   * keep using a blocked extension otherwise).
   */
  onBlocked(callback: (entry: VersionEntry) => void): void {
    this._onBlocked = callback;
  }

  /** Last-known block state — read by extension.ts to sync a panel that
   * resolves AFTER the check already ran (e.g. the secondary sidebar's chat
   * view, opened later in the session). */
  getBlockedEntry(): VersionEntry | null {
    return this._blockedEntry;
  }

  /** The actorium-mcp CLI's version-gate entry from the last successful
   * check, or null before the first check completes (or if it's always
   * failed — fail-open, same as the vscode check). Read by the Navigator
   * panel when building the CLI install-status row. */
  getActoriumMcpVersionEntry(): McpVersionEntry | null {
    return this._actoriumMcpEntry;
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
    const { bffUrl } = getActoriumConfig();

    try {
      const resp = await fetch(`${bffUrl}/extension/version`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        console.warn(`[actorium] Version check returned ${resp.status}`);
        return;
      }

      const versionInfo = (await resp.json()) as VersionInfo;
      this._actoriumMcpEntry = versionInfo.actorium_mcp ?? null;
      this._evaluate(versionInfo.vscode);
    } catch (err) {
      // Fail-open on network errors — just log and continue
      console.warn('[actorium] Version check failed (fail-open):', err);
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
    if (compareVersions(installed, vscEntry.min_version) < 0) {
      this._showBlockingBanner(vscEntry);
      return;
    }

    // Soft nudge (check suppression)
    const suppressed = this.context.globalState.get<number>(NUDGE_SUPPRESS_KEY);
    if (suppressed && Date.now() < suppressed) {
      return; // Still suppressed
    }

    if (compareVersions(installed, vscEntry.recommended_version) < 0) {
      this._showUpdateNudge(vscEntry);
    }
  }

  /**
   * Show a blocking banner — chat is disabled until update.
   */
  private async _showBlockingBanner(vscEntry: VersionEntry): Promise<void> {
    this._blockedEntry = vscEntry;
    vscode.commands.executeCommand('setContext', 'actorium.versionBlocked', true);
    // Drives the actual UI block — a persistent overlay in both webviews
    // that replaces the whole chat/navigator UI (composer included) until
    // updated, since the notification below is just a dismissible toast a
    // user can ignore and keep using an incompatible extension.
    this._onBlocked?.(vscEntry);

    const action = await vscode.window.showErrorMessage(
      `Actorium: This extension version (${this.EXTENSION_VERSION}) is no longer compatible with the backend (min: ${vscEntry.min_version}). Update to continue.`,
      { modal: false },
      'Update',
    );

    if (action === 'Update') {
      vscode.env.openExternal(vscode.Uri.parse(vscEntry.marketplace_url));
    }
  }

  /**
   * Show a non-blocking update nudge.
   */
  private async _showUpdateNudge(vscEntry: VersionEntry): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      `Actorium v${vscEntry.recommended_version} is available (you have ${this.EXTENSION_VERSION}).`,
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
   * Stop periodic checks.
   */
  dispose(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}
