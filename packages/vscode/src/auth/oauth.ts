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
import { deleteCredentialFile, writeCredentialFile } from './credentialFile.js';

const SECRET_KEY = 'actorium.authToken';
const WORKSPACE_ID_KEY = 'actorium.selectedWorkspaceId';
const WORKSPACE_LABEL_KEY = 'actorium.selectedWorkspaceLabel';
const ORG_ID_KEY = 'actorium.selectedOrgId';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes at 5s intervals

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
    // workspaceState (not globalState): scoped per opened folder/window by
    // VS Code itself, so each window remembers its own org/workspace
    // selection independently — opening a second window on a different
    // org's folder no longer fights with whichever workspace the first
    // window has selected. The login token (secrets, below) stays shared
    // across windows, which is correct — same login everywhere.
    this._selectedWorkspaceId = context.workspaceState.get<string>(WORKSPACE_ID_KEY) ?? null;
    this._selectedWorkspaceLabel = context.workspaceState.get<string>(WORKSPACE_LABEL_KEY) ?? null;
    this._selectedOrgId = context.workspaceState.get<string>(ORG_ID_KEY) ?? null;
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
      // Re-sync in case the credential file was deleted/never written on
      // this machine (e.g. it predates this feature) — org/workspace were
      // already restored from workspaceState in the constructor above.
      void this._syncCredentialFile();
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
   * Returns the currently selected organization's ID — needed alongside
   * getWorkspaceId() when writing the per-folder workspace manifest (see
   * workspace/workspaceManifest.ts) actorium-mcp reads to resolve its
   * org/workspace scope directly from its own cwd.
   */
  getOrgId(): string | null {
    return this._selectedOrgId;
  }

  /**
   * Overrides whatever selection the constructor restored from this folder's
   * own workspaceState, and re-persists it there too. Used once at activation
   * to apply a pending cross-reload selection (see folderManager's
   * stash/consumePendingWorkspaceSync) — switchWorkspace() reopening the
   * window into a different folder loses the in-memory selection it just
   * made, since workspaceState is scoped per folder and that write landed in
   * the folder that was open before the reload, not this one.
   */
  async applyPendingWorkspaceSelection(
    workspaceId: string,
    workspaceLabel: string,
    orgId: string | null,
  ): Promise<void> {
    this._selectedWorkspaceId = workspaceId;
    this._selectedWorkspaceLabel = workspaceLabel;
    this._selectedOrgId = orgId;
    await this.context.workspaceState.update(WORKSPACE_ID_KEY, workspaceId);
    await this.context.workspaceState.update(WORKSPACE_LABEL_KEY, workspaceLabel);
    await this.context.workspaceState.update(ORG_ID_KEY, orgId ?? undefined);
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
        await this._syncCredentialFile();

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

  /**
   * Mirrors current token/org/workspace state to the shared credential file
   * workflow-mcp reads (see credentialFile.ts) — called on every state
   * change (connect, workspace switch, disconnect) that also touches
   * SecretStorage/workspaceState above, so the file never drifts from what
   * this class itself considers the source of truth. Note this file is a
   * single machine-wide file, not scoped per window like workspaceState is
   * — with multiple windows open on different workspaces, whichever one
   * last synced "wins" as the default workspace_id/org_id for any
   * actorium-mcp call that omits them explicitly (every tool still accepts
   * an explicit workspace_id to override this).
   */
  private async _syncCredentialFile(): Promise<void> {
    if (!this._token) {
      await deleteCredentialFile();
      return;
    }
    await writeCredentialFile({
      accessToken: this._token,
      orgId: this._selectedOrgId ?? undefined,
      workspaceId: this._selectedWorkspaceId ?? undefined,
      updatedAt: Date.now(),
    });
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
    await this.context.workspaceState.update(WORKSPACE_ID_KEY, undefined);
    await this.context.workspaceState.update(WORKSPACE_LABEL_KEY, undefined);
    await this.context.workspaceState.update(ORG_ID_KEY, undefined);
    await this._syncCredentialFile();
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
   * Show the workspace picker — every org's workspaces in one flat list,
   * grouped by org via QuickPick separators — and store the selection.
   * Called automatically on first connect, and available via "Actorium:
   * Switch Workspace" any time after. A prior version mirrored
   * digital-factory-ui's OrgWorkspaceSwitcher popover literally (workspaces
   * of the current org first, with a "Switch organization" row that drilled
   * into a separate org picker) — that two-step hop doesn't earn its keep in
   * a QuickPick the way it does in a popover with two visual panels, so this
   * flattens straight to org > workspace in one list instead. Read-only
   * parity only: no "New workspace"/"Create organization" actions, since
   * those are write operations with no backend calls wired up in the
   * extension yet.
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

    type Item = vscode.QuickPickItem & { workspace?: WorkspaceSummary; org?: MeMembership };

    // Passed as a Promise rather than a resolved array so showQuickPick
    // renders its native busy/loading state while every org's workspaces
    // fetch in parallel, instead of blocking with no picker on screen yet.
    const itemsPromise: Promise<Item[]> = Promise.all(
      memberships.map(async (org) => {
        try {
          return { org, workspaces: await this._fetchWorkspaces(org.organization_id) };
        } catch (err) {
          vscode.window.showErrorMessage(`Actorium: ${err}`);
          return { org, workspaces: [] as WorkspaceSummary[] };
        }
      }),
    ).then((perOrg) => {
      const items: Item[] = [];
      for (const { org, workspaces } of perOrg) {
        items.push({
          label: `${org.organization_name} · ${org.member_count} member${org.member_count === 1 ? '' : 's'}`,
          kind: vscode.QuickPickItemKind.Separator,
        });
        if (workspaces.length === 0) {
          items.push({ label: `No workspaces in "${org.organization_name}"` });
          continue;
        }
        for (const w of workspaces) {
          items.push({
            // "Org / Workspace" breadcrumb, matching the sidebar's own
            // WorkspacePill label format (header.tsx) — the picker should
            // read the same way as the pill that opens it.
            label:
              (w.id === this._selectedWorkspaceId ? '$(check) ' : '') +
              `${org.organization_name} / ${w.name}`,
            description: w.slug,
            workspace: w,
            org,
          });
        }
      }
      return items;
    });

    const picked = await vscode.window.showQuickPick(itemsPromise, {
      placeHolder: 'Select a workspace',
      matchOnDescription: true,
    });
    if (!picked?.workspace || !picked.org) return;

    const org = picked.org;
    this._selectedWorkspaceId = picked.workspace.id;
    this._selectedWorkspaceLabel = `${picked.workspace.name} · ${org.organization_name}`;
    this._selectedOrgId = org.organization_id;
    await this.context.workspaceState.update(WORKSPACE_ID_KEY, this._selectedWorkspaceId);
    await this.context.workspaceState.update(WORKSPACE_LABEL_KEY, this._selectedWorkspaceLabel);
    await this.context.workspaceState.update(ORG_ID_KEY, this._selectedOrgId);
    await this._syncCredentialFile();
    vscode.window.showInformationMessage(
      `Actorium: Using workspace "${picked.workspace.name}" in "${org.organization_name}".`,
    );
    this._onWorkspaceChanged?.(this._selectedWorkspaceLabel);
  }
}
