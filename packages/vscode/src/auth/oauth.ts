import type {
  ApiSuccessResponse,
  DeviceCodeResponse,
  MeMembership,
  MeResponse,
  MeUser,
  TokenResponse,
  WorkspaceSummary,
} from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { getActoriumConfig } from '../config/environment.js';

const SECRET_KEY = 'actorium.authToken';
const WORKSPACE_ID_KEY = 'actorium.selectedWorkspaceId';
const WORKSPACE_LABEL_KEY = 'actorium.selectedWorkspaceLabel';
const ORG_ID_KEY = 'actorium.selectedOrgId';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes at 5s intervals
const SWITCH_ORG_ITEM = '__switch_org__';

/**
 * Manages OAuth device flow for the Actorium Agent.
 *
 * Flow:
 * 1. POST /oauth/device → get user_code + verification_uri
 * 2. Open browser to bffUrl + verification_uri + ?user_code=...
 * 3. Poll POST /oauth/token until success or timeout
 * 4. Store JWT in VS Code SecretStorage
 *
 * These endpoints are handled in-process by workflow-bff itself (not
 * proxied to user-service), registered at a plain /oauth prefix off the
 * bare BFF origin — see workflow-bff's internal/app/api/server/server.go
 * and internal/app/api/handler/deviceauth.
 */
export class AuthManager {
  private _token: string | null = null;
  private _selectedWorkspaceId: string | null = null;
  private _selectedWorkspaceLabel: string | null = null;
  private _selectedOrgId: string | null = null;
  private _userProfile: MeUser | null = null;
  private _pollTimer: NodeJS.Timeout | null = null;
  private _onConnected: (() => void) | null = null;
  private _onDisconnected: (() => void) | null = null;
  private _onWorkspaceChanged: ((label: string | null) => void) | null = null;
  private _onProfileChanged: ((profile: MeUser | null) => void) | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._selectedWorkspaceId = context.globalState.get<string>(WORKSPACE_ID_KEY) ?? null;
    this._selectedWorkspaceLabel = context.globalState.get<string>(WORKSPACE_LABEL_KEY) ?? null;
    this._selectedOrgId = context.globalState.get<string>(ORG_ID_KEY) ?? null;
  }

  /**
   * Registers a callback fired once a device-flow connection completes
   * (polling picked up a token). autoConnect() on activation does NOT fire
   * this — callers should check its return value directly for that case.
   */
  onConnected(callback: () => void): void {
    this._onConnected = callback;
  }

  /** Registers a callback fired on disconnect(). */
  onDisconnected(callback: () => void): void {
    this._onDisconnected = callback;
  }

  /**
   * Registers a callback fired whenever the selected workspace changes
   * (switchWorkspace() picks one, or disconnect() clears it to null).
   * Fires with the restored label on construction is NOT automatic —
   * callers should also check getWorkspaceLabel() directly at startup.
   */
  onWorkspaceChanged(callback: (label: string | null) => void): void {
    this._onWorkspaceChanged = callback;
  }

  /**
   * Registers a callback fired whenever the cached user profile changes
   * (populated after connecting/switching workspace, cleared on disconnect).
   */
  onProfileChanged(callback: (profile: MeUser | null) => void): void {
    this._onProfileChanged = callback;
  }

  /**
   * Returns the last-fetched user profile (name/email/avatar), or null if
   * not yet fetched. Populated as a side effect of _fetchOrgs — primed
   * fire-and-forget on connect/autoConnect, refreshed on switchWorkspace.
   */
  getUserProfile(): MeUser | null {
    return this._userProfile;
  }

  /**
   * Attempt to restore a stored token on activation.
   * Returns true if a valid token was found.
   */
  async autoConnect(): Promise<boolean> {
    const stored = await this.context.secrets.get(SECRET_KEY);
    if (stored) {
      this._token = stored;
      // Fire-and-forget: primes the account menu's name/email without
      // blocking activation on it — _fetchOrgs stashes the profile as a side
      // effect and notifies via onProfileChanged whenever it resolves.
      void this._fetchOrgs().catch(() => {});
      return true;
    }
    return false;
  }

  /**
   * Returns the current JWT token, or null if not authenticated.
   */
  async getToken(): Promise<string | null> {
    return this._token;
  }

  /**
   * Returns the currently selected workspace ID.
   */
  getWorkspaceId(): string | null {
    return this._selectedWorkspaceId;
  }

  /**
   * Returns a friendly "<workspace> · <org>" label for the current
   * selection, or null if none is selected yet.
   */
  getWorkspaceLabel(): string | null {
    return this._selectedWorkspaceLabel;
  }

  /**
   * Returns the currently selected organization ID — usage (GET
   * /api/me/usage) is per-org, not per-workspace, so the status bar's
   * usage card needs this to pick the right section out of the response.
   */
  getOrgId(): string | null {
    return this._selectedOrgId;
  }

  /**
   * Initiate the OAuth device flow:
   * 1. Request device code from user-service
   * 2. Open browser for user to authorize
   * 3. Begin polling for token
   */
  async startDeviceFlow(): Promise<void> {
    const { bffUrl, frontendUrl, clientId } = getActoriumConfig();

    try {
      // Step 1: Request device code
      const deviceResp = await fetch(`${bffUrl}/oauth/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });

      if (!deviceResp.ok) {
        throw new Error(`Device code request failed: ${deviceResp.status}`);
      }

      const deviceData = (await deviceResp.json()) as DeviceCodeResponse;

      // digital-factory-ui's device-authorize page is the only approval UI
      // now (the device flow's own /oauth/device/authorize endpoint —
      // handled in-process by workflow-bff, see its
      // internal/app/api/handler/deviceauth — is JSON-only, no HTML
      // rendering); the bffUrl fallback below only matters if frontendUrl is
      // explicitly misconfigured to empty. Either way, the response only
      // returns a relative verification_uri (e.g. "/oauth/device/authorize")
      // and no verification_uri_complete, so the full URL is built here.
      const userCodeQs = `user_code=${encodeURIComponent(deviceData.user_code)}`;
      const verificationUrl = frontendUrl
        ? `${frontendUrl}/device-authorize?${userCodeQs}`
        : `${bffUrl}${deviceData.verification_uri}?${userCodeQs}`;

      // Step 2: Open browser — best-effort. Environments with no registered
      // browser handler (headless/remote/devcontainer) can make openExternal
      // reject instead of resolving false, so this is wrapped separately: a
      // failure here must fall back to showing the code, not abort the whole
      // flow (which would also skip polling in Step 3 below).
      let opened = false;
      try {
        opened = await vscode.env.openExternal(vscode.Uri.parse(verificationUrl));
      } catch {
        opened = false;
      }

      if (!opened) {
        // Fallback: show the actual URL so the user can open it manually
        vscode.window.showInformationMessage(
          `Actorium: Visit ${verificationUrl} and enter code: ${deviceData.user_code}`,
        );
      }

      // Step 3: Begin polling
      await this._pollForToken(bffUrl, clientId, deviceData.device_code);
    } catch (err) {
      vscode.window.showErrorMessage(`Actorium auth error: ${err}`);
    }
  }

  /**
   * Poll the token endpoint until the user authorizes or the device code expires.
   */
  private async _pollForToken(bffUrl: string, clientId: string, deviceCode: string): Promise<void> {
    let attempts = 0;

    this._pollTimer = setInterval(async () => {
      attempts++;
      if (attempts > MAX_POLL_ATTEMPTS) {
        this._stopPolling();
        vscode.window.showErrorMessage('Actorium: Device code expired. Please try again.');
        return;
      }

      try {
        const tokenResp = await fetch(`${bffUrl}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });

        if (tokenResp.status === 400) {
          // Still waiting for user — authorization_pending or slow_down
          return;
        }

        if (!tokenResp.ok) {
          this._stopPolling();
          vscode.window.showErrorMessage(`Actorium: Token request failed (${tokenResp.status})`);
          return;
        }

        const tokenData = (await tokenResp.json()) as TokenResponse;

        this._token = tokenData.access_token;
        await this.context.secrets.store(SECRET_KEY, tokenData.access_token);

        this._stopPolling();

        vscode.window.showInformationMessage('Actorium: Connected!');
        vscode.commands.executeCommand('setContext', 'actorium.connected', true);
        void this._fetchOrgs().catch(() => {});
        this._onConnected?.();
      } catch (err) {
        this._stopPolling();
        vscode.window.showErrorMessage(`Actorium: Token request error: ${err}`);
      }
    }, POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Disconnect: clear the stored token.
   */
  async disconnect(): Promise<void> {
    this._token = null;
    this._selectedWorkspaceId = null;
    this._selectedWorkspaceLabel = null;
    this._selectedOrgId = null;
    this._userProfile = null;
    await this.context.secrets.delete(SECRET_KEY);
    await this.context.globalState.update(WORKSPACE_ID_KEY, undefined);
    await this.context.globalState.update(WORKSPACE_LABEL_KEY, undefined);
    await this.context.globalState.update(ORG_ID_KEY, undefined);
    vscode.commands.executeCommand('setContext', 'actorium.connected', false);
    vscode.window.showInformationMessage('Actorium: Disconnected.');
    this._onDisconnected?.();
    this._onWorkspaceChanged?.(null);
    this._onProfileChanged?.(null);
  }

  /**
   * Fetch the caller's org memberships — GET /api/me, the SAME endpoint the
   * browser's own org/workspace switcher uses. Sent as a bearer device-flow
   * JWT; workflow-bff verifies it (bearer-JWT auth is now a blanket
   * alternative to a session cookie on every auth_required route — see
   * workflow-bff's internal/app/api/handler/proxy) and forwards the resolved
   * identity to the real /api/me as trusted headers, identical to the
   * browser/session path. No dedicated /coding/me route is needed anymore.
   */
  private async _fetchOrgs(): Promise<MeMembership[]> {
    const { userServiceUrl } = getActoriumConfig();

    const resp = await fetch(`${userServiceUrl}/api/me`, {
      headers: { Authorization: `Bearer ${this._token}` },
    });
    if (!resp.ok) {
      throw new Error(`Failed to list organizations (${resp.status})`);
    }
    const body = (await resp.json()) as ApiSuccessResponse<MeResponse>;
    this._userProfile = body.data.user;
    this._onProfileChanged?.(this._userProfile);
    return body.data.memberships;
  }

  /**
   * Fetch the workspaces under a given organization — GET /api/workspaces,
   * the SAME endpoint the browser hits. Sent as a bearer device-flow JWT;
   * workflow-bff verifies it the same blanket way as _fetchOrgs above and
   * forwards to workflow-backend's normal /api/workspaces.
   */
  private async _fetchWorkspaces(orgId: string): Promise<WorkspaceSummary[]> {
    const { workflowBackendUrl } = getActoriumConfig();

    const resp = await fetch(
      `${workflowBackendUrl}/api/workspaces?org=${encodeURIComponent(orgId)}`,
      { headers: { Authorization: `Bearer ${this._token}` } },
    );
    if (!resp.ok) {
      throw new Error(`Failed to list workspaces (${resp.status})`);
    }
    const body = (await resp.json()) as ApiSuccessResponse<WorkspaceSummary[]>;
    return body.data;
  }

  /**
   * Show the workspace picker (scoped to the current/last-used org) and
   * store the selection. Called automatically on first connect, and
   * available via "Actorium: Switch Workspace" any time after. Mirrors
   * digital-factory-ui's OrgWorkspaceSwitcher popover's two-level structure
   * (workspaces-of-current-org first, with a "Switch organization" escape
   * hatch into the full org list) rather than always asking org-then-
   * workspace — read-only parity only: no "New workspace"/"Create
   * organization" actions, since those are write operations with no backend
   * calls wired up in the extension yet.
   */
  async switchWorkspace(): Promise<void> {
    if (!this._token) {
      vscode.window.showWarningMessage('Actorium: Connect first before switching workspace.');
      return;
    }

    let memberships: MeMembership[];
    try {
      memberships = await this._fetchOrgs();
    } catch (err) {
      vscode.window.showErrorMessage(`Actorium: ${err}`);
      return;
    }

    if (memberships.length === 0) {
      vscode.window.showInformationMessage('Actorium: No organizations available.');
      return;
    }

    const startingOrg = memberships.find((m) => m.organization_id === this._selectedOrgId);
    await this._pickWorkspaceForOrg(memberships, startingOrg ?? memberships[0]!);
  }

  /**
   * Shows the workspace list for `org` (with a checkmark on the currently
   * selected one, per digital-factory-ui's WORKSPACES section), plus — when
   * the caller belongs to more than one org — a "Switch organization" row
   * that hands off to _pickOrg. Recurses back into itself after a org switch
   * so the flow always ends on a workspace list, matching the browser
   * popover's own back-and-forth between its two panels.
   */
  private async _pickWorkspaceForOrg(
    memberships: MeMembership[],
    org: MeMembership,
  ): Promise<void> {
    let workspaces: WorkspaceSummary[];
    try {
      workspaces = await this._fetchWorkspaces(org.organization_id);
    } catch (err) {
      vscode.window.showErrorMessage(`Actorium: ${err}`);
      return;
    }

    type Item = vscode.QuickPickItem & {
      workspace?: WorkspaceSummary;
      action?: typeof SWITCH_ORG_ITEM;
    };
    const items: Item[] = workspaces.map((w) => ({
      label: (w.id === this._selectedWorkspaceId ? '$(check) ' : '') + w.name,
      description: w.slug,
      workspace: w,
    }));
    if (memberships.length > 1) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(arrow-swap) Switch organization', action: SWITCH_ORG_ITEM },
      );
    }

    const title = `${org.organization_name} · ${org.member_count} member${org.member_count === 1 ? '' : 's'}`;
    const picked = await vscode.window.showQuickPick(items, {
      title,
      placeHolder:
        workspaces.length === 0
          ? `No workspaces in "${org.organization_name}"`
          : 'Select a workspace',
    });
    if (!picked) return;

    if (picked.action === SWITCH_ORG_ITEM) {
      await this._pickOrg(memberships);
      return;
    }
    if (!picked.workspace) return;

    this._selectedWorkspaceId = picked.workspace.id;
    this._selectedWorkspaceLabel = `${picked.workspace.name} · ${org.organization_name}`;
    this._selectedOrgId = org.organization_id;
    await this.context.globalState.update(WORKSPACE_ID_KEY, this._selectedWorkspaceId);
    await this.context.globalState.update(WORKSPACE_LABEL_KEY, this._selectedWorkspaceLabel);
    await this.context.globalState.update(ORG_ID_KEY, this._selectedOrgId);
    vscode.window.showInformationMessage(
      `Actorium: Using workspace "${picked.workspace.name}" in "${org.organization_name}".`,
    );
    this._onWorkspaceChanged?.(this._selectedWorkspaceLabel);
  }

  /**
   * "Switch organization" panel — full org list with member counts and a
   * checkmark on the current org, mirroring digital-factory-ui's own
   * "Switch organization" sub-panel. Picking one re-enters
   * _pickWorkspaceForOrg for that org.
   */
  private async _pickOrg(memberships: MeMembership[]): Promise<void> {
    const items = memberships.map((m) => ({
      label: (m.organization_id === this._selectedOrgId ? '$(check) ' : '') + m.organization_name,
      description: `${m.member_count} member${m.member_count === 1 ? '' : 's'}`,
      org: m,
    }));
    const picked = await vscode.window.showQuickPick(items, { title: 'Switch organization' });
    if (!picked) return;
    await this._pickWorkspaceForOrg(memberships, picked.org);
  }
}
