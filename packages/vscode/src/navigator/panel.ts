import type { MeUser, VersionEntry } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import {
  codingApiConfig,
  type CodingApiContext,
  deleteSession,
  getFeatureTasks,
  listDocuments,
  listFeatures,
  listSessions,
} from '../chat/coding-api.js';
import type { ChatPanelProvider } from '../chat/panel.js';
import { getActoriumConfig } from '../config/environment.js';
import { buildWebviewHtml } from '../webview-html.js';
import { DocContentProvider } from './doc-content-provider.js';
import { openWorkspaceDocument } from './open-document.js';

/**
 * Navigator panel provider — manages the primary-sidebar webview that lists
 * the current workspace's chat sessions, documents, and features (the
 * left-hand counterpart to the chat webview, which lives in the secondary
 * sidebar — see packages/vscode/package.json's viewsContainers).
 */
export class NavigatorPanelProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;
  private _connected = false;
  private _workspaceLabel: string | null = null;
  private _userProfile: MeUser | null = null;
  private _versionBlockedEntry: VersionEntry | null = null;
  private _chatPanel: ChatPanelProvider | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly codingApiCtx: CodingApiContext,
    private readonly onLoadSession: (sessionId: string) => Promise<void>,
    private readonly onNewChat: () => void,
    private readonly docContentProvider: DocContentProvider,
    private readonly getCurrentSessionId: () => string | null,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist')],
    };

    webviewView.webview.html = buildWebviewHtml(this.context, webviewView.webview, 'navigator');

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'connect':
          vscode.commands.executeCommand('actorium.connect');
          break;

        case 'switchWorkspace':
          vscode.commands.executeCommand('actorium.switchWorkspace');
          break;

        case 'newChat':
          this.onNewChat();
          // Reveal the chat panel in the secondary sidebar — otherwise
          // clearing an already-empty, off-screen chat looks like the click
          // did nothing at all.
          vscode.commands.executeCommand('actorium.chatPanel.focus');
          break;

        case 'signOut':
          vscode.commands.executeCommand('actorium.disconnect');
          break;

        case 'openProfileSettings': {
          const { frontendUrl } = getActoriumConfig();
          vscode.env.openExternal(vscode.Uri.parse(`${frontendUrl}/settings/profile`));
          break;
        }

        case 'listSessions':
          await this._loadSessions();
          break;

        case 'deleteSession': {
          const workspaceId = this.codingApiCtx.getWorkspaceId();
          if (workspaceId)
            await deleteSession(codingApiConfig(this.codingApiCtx), message.sessionId);
          // The chat webview persists its OWN transcript cache independent
          // of this session list (vscode.getState() in
          // use-chat-controller.ts) — deleting a session server-side does
          // nothing to that cache on its own. If the deleted session is the
          // one currently open in chat, clear it the same way "New chat"
          // does (also resets SseClient's session id so the next message
          // doesn't try to continue a session that no longer exists).
          if (message.sessionId === this.getCurrentSessionId()) {
            this.onNewChat();
          }
          await this._loadSessions();
          break;
        }

        case 'loadSession':
          await this.onLoadSession(message.sessionId);
          break;

        case 'listDocs': {
          const workspaceId = this.codingApiCtx.getWorkspaceId();
          const docs = workspaceId
            ? await listDocuments(codingApiConfig(this.codingApiCtx), workspaceId)
            : null;
          this._postMessage({ command: 'docsLoaded', docs: docs ?? [] });
          break;
        }

        case 'listFeatures': {
          const workspaceId = this.codingApiCtx.getWorkspaceId();
          const features = workspaceId
            ? await listFeatures(codingApiConfig(this.codingApiCtx), workspaceId)
            : null;
          this._postMessage({ command: 'featuresLoaded', features: features ?? [] });
          break;
        }

        case 'insertMention':
          this._chatPanel?.insertMention(message.token);
          vscode.commands.executeCommand('actorium.chatPanel.focus');
          break;

        case 'listFeatureTasks': {
          const workspaceId = this.codingApiCtx.getWorkspaceId();
          const tasks = workspaceId
            ? await getFeatureTasks(
                codingApiConfig(this.codingApiCtx),
                workspaceId,
                message.featureId,
              )
            : null;
          this._postMessage({
            command: 'featureTasksLoaded',
            featureId: message.featureId,
            tasks: tasks ?? [],
          });
          break;
        }

        case 'openDocument':
          await openWorkspaceDocument(message.doc, this.codingApiCtx, this.docContentProvider);
          break;

        case 'openMarketplace':
          vscode.env.openExternal(vscode.Uri.parse(message.url));
          break;

        case 'ready':
          this._syncState();
          break;
      }
    });
  }

  private async _loadSessions(): Promise<void> {
    const workspaceId = this.codingApiCtx.getWorkspaceId();
    const sessions = workspaceId
      ? await listSessions(codingApiConfig(this.codingApiCtx), workspaceId)
      : null;
    this._postMessage({ command: 'sessionsLoaded', sessions: sessions ?? [] });
  }

  /** Re-send extension-owned state on the webview's 'ready' handshake — same
   * pattern as ChatPanelProvider._syncState. */
  private _syncState(): void {
    this._postMessage({ command: 'connectionChanged', connected: this._connected });
    this._postMessage({ command: 'workspaceLabelChanged', label: this._workspaceLabel });
    this._postMessage({ command: 'userProfileChanged', profile: this._userProfile });
    if (this._versionBlockedEntry) {
      this._postMessage({ command: 'versionBlocked', entry: this._versionBlockedEntry });
    }
  }

  setConnected(connected: boolean): void {
    this._connected = connected;
    this._postMessage({ command: 'connectionChanged', connected });
  }

  setWorkspaceLabel(label: string | null): void {
    this._workspaceLabel = label;
    this._postMessage({ command: 'workspaceLabelChanged', label });
  }

  /** Update the user profile (name/email/avatar) shown in the navigator
   * header's account menu, or null to clear it on disconnect. */
  setUserProfile(profile: MeUser | null): void {
    this._userProfile = profile;
    this._postMessage({ command: 'userProfileChanged', profile });
  }

  /** Wired after both providers are constructed (extension.ts) — avoids a
   * constructor-order cycle since ChatPanelProvider doesn't need to know
   * about the navigator. */
  setChatPanel(chatPanel: ChatPanelProvider): void {
    this._chatPanel = chatPanel;
  }

  /** Shows the same persistent, non-dismissible block overlay as
   * ChatPanelProvider.setVersionBlocked — the navigator has its own separate
   * webview, so it needs its own copy of this state rather than relying on
   * whatever the chat panel is showing. */
  setVersionBlocked(entry: VersionEntry): void {
    this._versionBlockedEntry = entry;
    this._postMessage({ command: 'versionBlocked', entry });
  }

  private _postMessage(message: Record<string, unknown>): void {
    this._view?.webview.postMessage(message);
  }
}
