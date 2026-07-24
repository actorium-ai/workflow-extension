import type { CreditInfo } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import {
  barIcon,
  computeBarState,
  formatDailyCountdown,
  formatWeeklyCountdown,
  type OrgUsage,
  renderBar,
} from './usage.js';

/**
 * Credit status bar item — shows Actorium credit balance in the VS Code status bar.
 *
 * Displays: "Actorium: ✓" when connected (no balance info yet) or
 * "Actorium: 1,234 credits" when balance is received via SSE cost events.
 *
 * The hover tooltip is a richer card (plan name, daily/weekly usage bars —
 * mirrors digital-factory-ui's Settings > Usage tab and GitHub Copilot's own
 * status bar popup) built from GET /api/me/usage, refreshed by extension.ts
 * via updateUsage() on connect/workspace-switch/a periodic timer. Click
 * still opens the existing QuickPick account menu (actorium.showAccountMenu)
 * — the tooltip is hover-only, VS Code status bar items don't support a
 * click-to-open rich panel the way this class's own text suggests Copilot's
 * does, so hover is the closest equivalent available via the public API.
 */
export class CreditsStatusBar {
  private _item: vscode.StatusBarItem;
  private _info: CreditInfo | null = null;
  private _usageSections: OrgUsage[] = [];
  private _activeOrgId: string | null = null;

  constructor(context: vscode.ExtensionContext) {
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._item.name = 'Actorium Credits';
    this._item.command = 'actorium.showAccountMenu';

    context.subscriptions.push(this._item);
  }

  /**
   * Show the status bar item.
   */
  show(): void {
    this._item.text = '$(actorium-logo) Actorium';
    this._rebuildTooltip();
    this._item.show();
  }

  /**
   * Update the credit display with data from a cost event.
   */
  update(info: CreditInfo): void {
    this._info = info;
    if (info.balance !== undefined) {
      this._item.text = `$(actorium-logo) Actorium: ${info.balance.toLocaleString()} credits`;
    } else {
      this._item.text = '$(actorium-logo) Actorium';
    }
    this._rebuildTooltip();
  }

  /**
   * Update the daily/weekly usage card with a fresh GET /api/me/usage
   * response — called by extension.ts on connect, on org/workspace switch,
   * and on a periodic timer (usage isn't pushed live the way credit balance
   * is via SSE cost events, so it has to be polled).
   */
  updateUsage(sections: OrgUsage[], activeOrgId: string | null): void {
    this._usageSections = sections;
    this._activeOrgId = activeOrgId;
    this._rebuildTooltip();
  }

  /**
   * Update tooltip (e.g., for connection state changes) — plain-text only,
   * used before the first usage fetch / while disconnected. Overwritten by
   * the next updateUsage()/update() call once real data is available.
   */
  setTooltip(text: string): void {
    this._item.tooltip = text;
  }

  private _rebuildTooltip(): void {
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    md.isTrusted = true;

    md.appendMarkdown('**$(actorium-logo) Actorium Agent**\n\n');

    if (this._info?.balance !== undefined) {
      md.appendMarkdown(`**${this._info.balance.toLocaleString()}** credits remaining`);
      if (this._info.used) {
        md.appendMarkdown(` — ${this._info.used.toLocaleString()} used this session`);
      }
      md.appendMarkdown('\n\n');
    }

    const active =
      this._usageSections.find((s) => s.org_id === this._activeOrgId) ??
      this._usageSections[0] ??
      null;
    if (active) {
      md.appendMarkdown('---\n\n');
      md.appendMarkdown(
        `**${active.plan_display_name || active.plan_name}** · ${active.org_name}\n\n`,
      );

      const now = new Date();
      const daily = computeBarState(active.daily_used, active.daily_cap, active.daily_reset_at);
      const weekly = computeBarState(active.weekly_used, active.weekly_cap, active.weekly_reset_at);

      md.appendMarkdown(`${barIcon(daily.color)} **Daily** — ${daily.pct}% used\n\n`);
      md.appendMarkdown('```\n' + renderBar(daily.pct) + '\n```\n\n');
      md.appendMarkdown(`${formatDailyCountdown(daily.resetAt, now)}\n\n`);

      md.appendMarkdown(`${barIcon(weekly.color)} **Weekly** — ${weekly.pct}% used\n\n`);
      md.appendMarkdown('```\n' + renderBar(weekly.pct) + '\n```\n\n');
      md.appendMarkdown(`${formatWeeklyCountdown(weekly.resetAt)}\n\n`);
    }

    md.appendMarkdown('---\n\n');
    md.appendMarkdown('$(account) Click for account options');

    this._item.tooltip = md;
  }

  /**
   * Dispose the status bar item.
   */
  dispose(): void {
    this._item.dispose();
  }
}
