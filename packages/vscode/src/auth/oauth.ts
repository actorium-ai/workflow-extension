import * as vscode from 'vscode';
import type { DeviceCodeResponse, TokenResponse, WorkspaceInfo } from '@workflow-extension/shared';

const SECRET_KEY = 'hermes.authToken';
const DEVICE_CODE_KEY = 'hermes.deviceCode';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes at 5s intervals

/**
 * Manages OAuth device flow for the Hermes IDE Coding Agent.
 *
 * Flow:
 * 1. POST /oauth/device → get user_code + verification_uri
 * 2. Open browser to verification_uri_complete
 * 3. Poll POST /oauth/token until success or timeout
 * 4. Store JWT in VS Code SecretStorage
 */
export class AuthManager {
  private _token: string | null = null;
  private _selectedWorkspaceId: string | null = null;
  private _pollTimer: NodeJS.Timeout | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Attempt to restore a stored token on activation.
   * Returns true if a valid token was found.
   */
  async autoConnect(): Promise<boolean> {
    const stored = await this.context.secrets.get(SECRET_KEY);
    if (stored) {
      this._token = stored;
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
   * Initiate the OAuth device flow:
   * 1. Request device code from user-service
   * 2. Open browser for user to authorize
   * 3. Begin polling for token
   */
  async startDeviceFlow(): Promise<void> {
    const config = vscode.workspace.getConfiguration('hermes');
    const userServiceUrl = config.get<string>('userServiceUrl') ?? '';
    const clientId = config.get<string>('clientId') ?? 'hermes-vscode';

    if (!userServiceUrl) {
      vscode.window.showErrorMessage(
        'Hermes: userServiceUrl is not configured. Set it in settings.',
      );
      return;
    }

    try {
      // Step 1: Request device code
      const deviceResp = await fetch(`${userServiceUrl}/oauth/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });

      if (!deviceResp.ok) {
        throw new Error(`Device code request failed: ${deviceResp.status}`);
      }

      const deviceData = (await deviceResp.json()) as DeviceCodeResponse;

      // Step 2: Open browser
      const opened = await vscode.env.openExternal(
        vscode.Uri.parse(deviceData.verification_uri_complete),
      );

      if (!opened) {
        // Fallback: show the code in a message so the user can paste it
        vscode.window.showInformationMessage(
          `Hermes: Visit ${deviceData.verification_uri} and enter code: ${deviceData.user_code}`,
        );
      }

      vscode.window.showInformationMessage(
        `Hermes: Enter code "${deviceData.user_code}" in your browser to connect.`,
      );

      // Step 3: Begin polling
      await this._pollForToken(userServiceUrl, clientId, deviceData.device_code);
    } catch (err) {
      vscode.window.showErrorMessage(`Hermes auth error: ${err}`);
    }
  }

  /**
   * Poll the token endpoint until the user authorizes or the device code expires.
   */
  private async _pollForToken(
    userServiceUrl: string,
    clientId: string,
    deviceCode: string,
  ): Promise<void> {
    let attempts = 0;

    this._pollTimer = setInterval(async () => {
      attempts++;
      if (attempts > MAX_POLL_ATTEMPTS) {
        this._stopPolling();
        vscode.window.showErrorMessage('Hermes: Device code expired. Please try again.');
        return;
      }

      try {
        const tokenResp = await fetch(`${userServiceUrl}/oauth/token`, {
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
          vscode.window.showErrorMessage(`Hermes: Token request failed (${tokenResp.status})`);
          return;
        }

        const tokenData = (await tokenResp.json()) as TokenResponse;

        this._token = tokenData.access_token;
        await this.context.secrets.store(SECRET_KEY, tokenData.access_token);

        this._stopPolling();

        vscode.window.showInformationMessage('Hermes: Connected!');
        vscode.commands.executeCommand('setContext', 'hermes.connected', true);
      } catch (err) {
        this._stopPolling();
        vscode.window.showErrorMessage(`Hermes: Token request error: ${err}`);
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
    await this.context.secrets.delete(SECRET_KEY);
    vscode.commands.executeCommand('setContext', 'hermes.connected', false);
    vscode.window.showInformationMessage('Hermes: Disconnected.');
  }

  /**
   * Show workspace picker and let the user select a workspace.
   */
  async switchWorkspace(): Promise<void> {
    if (!this._token) {
      vscode.window.showWarningMessage('Hermes: Connect first before switching workspace.');
      return;
    }

    const workspaces = await this._fetchWorkspaces();
    if (!workspaces || workspaces.length === 0) {
      vscode.window.showInformationMessage('Hermes: No workspaces available.');
      return;
    }

    const items = workspaces.map((w) => ({
      label: w.name,
      description: w.id,
      detail: `Org: ${w.org_id}`,
      workspace: w,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a workspace',
    });

    if (picked) {
      this._selectedWorkspaceId = picked.workspace.id;
      vscode.window.showInformationMessage(`Hermes: Connected to "${picked.label}".`);
    }
  }

  /**
   * Fetch accessible workspaces for the current user.
   */
  private async _fetchWorkspaces(): Promise<WorkspaceInfo[]> {
    const config = vscode.workspace.getConfiguration('hermes');
    const userServiceUrl = config.get<string>('userServiceUrl') ?? '';

    try {
      const resp = await fetch(`${userServiceUrl}/api/workspaces`, {
        headers: { Authorization: `Bearer ${this._token}` },
      });
      if (!resp.ok) {
        return [];
      }
      return resp.json() as Promise<WorkspaceInfo[]>;
    } catch {
      return [];
    }
  }
}
