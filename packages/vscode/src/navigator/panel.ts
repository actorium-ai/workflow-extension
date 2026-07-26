import type { MeUser, VersionEntry } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { getActoriumConfig } from '../config/environment.js';
import { compareVersions, type VersionChecker } from '../version/checker.js';
import { buildWebviewHtml } from '../webview-html.js';
import { getWorkspaceFolder } from '../workspace/folderManager.js';
import {
  type AgentTarget,
  DEFAULT_MCP_NPM_PACKAGE,
  getClaudeCodeStatus,
  getCodexStatus,
  getMcpCliStatus,
  getOpencodeStatus,
  installMcpCli,
} from '../workspace/mcpConnect.js';
import { listLinkedRepos } from '../workspace/repoLinker.js';
import { DocContentProvider } from './doc-content-provider.js';
import { FeatureDetailPanel } from './feature-detail-panel.js';
import { FeaturesBrowserPanel } from './features-browser-panel.js';
import { openWorkspaceDocument } from './open-document.js';
import {
  codingApiConfig,
  type CodingApiContext,
  getWorkspaceRepos,
  listDocuments,
  listFeatures,
} from './workflow-api.js';

/**
 * Navigator panel provider — manages the extension's one webview (primary
 * sidebar), listing the current workspace's documents, features, and linked
 * local repos.
 */
export class NavigatorPanelProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;
  private _connected = false;
  private _workspaceLabel: string | null = null;
  private _userProfile: MeUser | null = null;
  private _versionBlockedEntry: VersionEntry | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly codingApiCtx: CodingApiContext,
    private readonly docContentProvider: DocContentProvider,
    private readonly getWorkspaceId: () => string | null,
    private readonly versionChecker: VersionChecker,
    private readonly regenerateAgentsFile: (folderPath: string) => Promise<void>,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist')],
    };

    webviewView.webview.html = buildWebviewHtml(this.context, webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'connect':
          vscode.commands.executeCommand('actorium.connect');
          break;

        case 'switchWorkspace':
          vscode.commands.executeCommand('actorium.switchWorkspace');
          break;

        case 'signOut':
          vscode.commands.executeCommand('actorium.disconnect');
          break;

        case 'openProfileSettings': {
          const { frontendUrl } = getActoriumConfig();
          vscode.env.openExternal(vscode.Uri.parse(`${frontendUrl}/settings/profile`));
          break;
        }

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

        case 'openDocument':
          await openWorkspaceDocument(message.doc, this.codingApiCtx, this.docContentProvider);
          break;

        case 'openFeatureDetail':
          FeatureDetailPanel.createOrShow(this.context, this.codingApiCtx, message.feature);
          break;

        case 'openFeaturesBrowser':
          FeaturesBrowserPanel.createOrShow(this.context, this.codingApiCtx);
          break;

        case 'tagInPrompt':
          this._tagInPrompt(message.text);
          break;

        case 'openMarketplace':
          vscode.env.openExternal(vscode.Uri.parse(message.url));
          break;

        case 'listRepos':
          await this._loadRepos();
          break;

        case 'addRepo':
          await vscode.commands.executeCommand('actorium.addRepo');
          await this._loadRepos();
          break;

        case 'listMcpStatus':
          await this._loadMcpStatus();
          break;

        case 'connectAgent':
          await vscode.commands.executeCommand('actorium.connectAgentTarget', message.target);
          await this._loadMcpStatus();
          break;

        case 'disconnectAgent':
          await vscode.commands.executeCommand('actorium.disconnectAgentTarget', message.target);
          await this._loadMcpStatus();
          break;

        case 'getMcpCliStatus':
          await this._loadMcpCliStatus();
          break;

        case 'installMcpCli':
          await this._installMcpCli();
          break;

        case 'openWorkspaceFolder':
          // A specific repo row's click also lands here (see
          // workspace-panel.tsx) — every repo is a symlink directly inside
          // the workspace folder, so opening that root already surfaces it
          // in the Explorer; there's no separate "open just this repo" mode.
          vscode.commands.executeCommand('actorium.openWorkspaceFolder');
          break;

        case 'ready':
          this._syncState();
          break;
      }
    });
  }

  /**
   * Inserts a plain-text reference into whatever terminal the user is
   * mid-typing a prompt into (a coding agent CLI session) — not a structured
   * mention, just a hint the agent can resolve with its own MCP tools
   * (get_feature by name, read_storage_document by path, etc). Falls back to
   * the clipboard when no terminal is focused, since `sendText` has nowhere
   * to go otherwise.
   */
  private async _tagInPrompt(text: string): Promise<void> {
    const terminal = vscode.window.activeTerminal;
    if (terminal) {
      terminal.show(true);
      terminal.sendText(text, false);
      return;
    }
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(
      `Actorium: No active terminal — copied "${text}" to clipboard instead.`,
    );
  }

  /**
   * Merges the workspace's actual repo list (from workflow-backend) with
   * what's really symlinked into the local workspace folder, so the sidebar
   * can show which of the workspace's repos still need linking rather than
   * just listing whatever happens to be on disk. Falls back to disk-only
   * (every entry `linked: true`, as before this cross-reference existed) if
   * the API call fails — offline shouldn't blank out a working local list.
   */
  private async _loadRepos(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
    const [linked, workspaceRepos] = await Promise.all([
      folder ? listLinkedRepos(folder) : Promise.resolve([]),
      workspaceId
        ? getWorkspaceRepos(codingApiConfig(this.codingApiCtx), workspaceId)
        : Promise.resolve(null),
    ]);

    const linkedByName = new Map(linked.map((r) => [r.name.toLowerCase(), r]));
    const seen = new Set<string>();
    const repos: { name: string; target?: string; linked: boolean }[] = [];

    for (const wr of workspaceRepos ?? []) {
      const local = linkedByName.get(wr.repo_id.toLowerCase());
      seen.add(wr.repo_id.toLowerCase());
      repos.push({ name: wr.repo_id, target: local?.target, linked: !!local });
    }
    // Any locally-linked repo the workspace API doesn't know about (linked
    // before being registered workspace-side, or an unrelated folder) still
    // shows up, same as before this cross-reference existed.
    for (const r of linked) {
      if (!seen.has(r.name.toLowerCase()))
        repos.push({ name: r.name, target: r.target, linked: true });
    }

    this._postMessage({ command: 'reposLoaded', repos, hasWorkspaceFolder: !!folder });
  }

  /** Passive status check — never prompts to link a workspace folder (unlike
   * the connect/disconnect commands), since this fires automatically on
   * every panel load/refresh and shouldn't surprise the user with a QuickPick
   * just for opening the sidebar. */
  private async _loadMcpStatus(): Promise<void> {
    const workspaceId = this.getWorkspaceId();
    const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
    if (!folder) {
      this._postMessage({ command: 'mcpStatusLoaded', statuses: {} });
      return;
    }
    const [claude, codex, opencode] = await Promise.all([
      getClaudeCodeStatus(folder),
      getCodexStatus(folder),
      getOpencodeStatus(folder),
    ]);
    const statuses: Record<AgentTarget, unknown> = { claude, codex, opencode };
    this._postMessage({ command: 'mcpStatusLoaded', statuses });
  }

  /**
   * Checks whether the actorium-mcp CLI itself is installed (separate from
   * per-agent registration, see _loadMcpStatus above) and, if so, compares
   * it against the BFF's version-gate entry — `updateRequired` mirrors the
   * extension's own hard-block model (installed < min_version), just scoped
   * to this one row instead of the whole panel.
   */
  private async _loadMcpCliStatus(): Promise<void> {
    const cli = await getMcpCliStatus();
    const entry = this.versionChecker.getActoriumMcpVersionEntry();
    const npmPackage = entry?.npm_package || DEFAULT_MCP_NPM_PACKAGE;

    const installedVersion = cli.installed ? cli.version : undefined;
    const updateRequired =
      installedVersion !== undefined &&
      !!entry &&
      compareVersions(installedVersion, entry.min_version) < 0;
    const updateAvailable =
      installedVersion !== undefined &&
      !!entry &&
      compareVersions(installedVersion, entry.recommended_version) < 0;

    this._postMessage({
      command: 'mcpCliStatusLoaded',
      status: {
        installed: cli.installed,
        version: cli.version,
        npmPackage,
        updateRequired,
        updateAvailable,
      },
    });
  }

  /** Installs/updates the actorium-mcp CLI via npm, then re-syncs AGENTS.md
   * (see extension.ts's regenerateAgentsFile) so a newly-installed CLI is
   * reflected there too — same "sync after every state change" precedent as
   * addRepo above. */
  private async _installMcpCli(): Promise<void> {
    const entry = this.versionChecker.getActoriumMcpVersionEntry();
    const npmPackage = entry?.npm_package || DEFAULT_MCP_NPM_PACKAGE;

    const result = await installMcpCli(npmPackage);
    if (result.ok) {
      vscode.window.showInformationMessage(`Actorium: ${result.message}`);
      const workspaceId = this.getWorkspaceId();
      const folder = workspaceId ? getWorkspaceFolder(this.context, workspaceId) : undefined;
      if (folder) await this.regenerateAgentsFile(folder);
    } else {
      vscode.window.showErrorMessage(`Actorium: ${result.message}`);
    }
    await this._loadMcpCliStatus();
  }

  /** Re-send extension-owned state on the webview's 'ready' handshake. */
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

  /** Shows a persistent, non-dismissible block overlay when the extension
   * version falls below the backend's minimum supported version. */
  setVersionBlocked(entry: VersionEntry): void {
    this._versionBlockedEntry = entry;
    this._postMessage({ command: 'versionBlocked', entry });
  }

  private _postMessage(message: Record<string, unknown>): void {
    this._view?.webview.postMessage(message);
  }
}
