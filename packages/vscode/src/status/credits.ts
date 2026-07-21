import * as vscode from 'vscode';
import type { CreditInfo } from '@workflow-extension/shared';

/**
 * Credit status bar item — shows Hermes credit balance in the VS Code status bar.
 *
 * Displays: "Hermes: ✓" when connected (no balance info yet) or
 * "Hermes: 1,234 credits" when balance is received via SSE cost events.
 */
export class CreditsStatusBar {
  private _item: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._item.name = 'Hermes Credits';
    this._item.command = 'hermes.connect';
    this._item.tooltip = 'Hermes IDE Coding Agent — click to connect';

    context.subscriptions.push(this._item);
  }

  /**
   * Show the status bar item.
   */
  show(): void {
    this._item.text = '$(hubot) Hermes';
    this._item.show();
  }

  /**
   * Update the credit display with data from a cost event.
   */
  update(info: CreditInfo): void {
    if (info.balance !== undefined) {
      this._item.text = `$(hubot) Hermes: ${info.balance.toLocaleString()} credits`;
      this._item.tooltip = [
        `Balance: ${info.balance.toLocaleString()}`,
        info.used ? `Used this session: ${info.used.toLocaleString()}` : null,
      ]
        .filter(Boolean)
        .join(' | ');
    } else {
      this._item.text = '$(hubot) Hermes ✓';
      this._item.tooltip = 'Hermes IDE Coding Agent — connected';
    }
  }

  /**
   * Update tooltip (e.g., for connection state changes).
   */
  setTooltip(text: string): void {
    this._item.tooltip = text;
  }

  /**
   * Dispose the status bar item.
   */
  dispose(): void {
    this._item.dispose();
  }
}
