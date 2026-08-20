import type {
  AccountSummary,
  ApiSuccessResponse,
  DeviceCodeResponse,
  MeMembership,
  MeResponse,
  MeUser,
  TokenResponse,
  WorkspaceSummary,
} from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { deriveServiceUrls, ENVIRONMENTS, getActoriumConfig } from '../config/environment.js';
import { deleteCredentialFile, writeCredentialFile } from './credentialFile.js';

const SECRET_KEY_PREFIX = 'actorium.authToken';
const REFRESH_SECRET_KEY_PREFIX = 'actorium.refreshToken';
const WORKSPACE_ID_KEY = 'actorium.selectedWorkspaceId';
const WORKSPACE_LABEL_KEY = 'actorium.selectedWorkspaceLabel';
const ORG_ID_KEY = 'actorium.selectedOrgId';
const ACTIVE_ACCOUNT_KEY = 'actorium.activeAccountId';
const ACCOUNTS_KEY = 'actorium.accounts';
const LAST_ACTIVE_BY_BFFURL_KEY = 'actorium.lastActiveAccountByBffUrl';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes at 5s intervals

/** How far ahead of the access token's own expiry a silent renewal is
 * attempted. Wide enough to absorb clock skew between this machine and the
 * backend plus a slow/retried request, so the token in hand is still
 * accepted while its replacement is being fetched — renewal never has to
 * race an expiry it is already too late for. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Floor on the proactive timer, so a short-TTL token (or a clock jump) can
 * never turn renewal into a hot loop against /oauth/token. */
const MIN_REFRESH_DELAY_MS = 30 * 1000;

/** setTimeout stores its delay in a 32-bit int; anything larger silently
 * fires immediately. Long TTLs are clamped to this and simply re-scheduled
 * when the timer next fires. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** Retry delay after a renewal that failed for a reason that is likely to
 * pass on its own — offline, DNS, a 5xx. Deliberately unrelated to the
 * token's expiry: the credential is still believed good, this is just a
 * backoff. */
const REFRESH_RETRY_MS = 60 * 1000;

/** Renewal must not hang forever on a wedged connection — it runs on a timer
 * and behind getToken(), so a stuck request would stall real work. */
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * What one renewal attempt concluded — the distinction the callers actually
 * act on, which a boolean can't carry:
 *
 * - `renewed`     — new access (and refresh) token stored; nothing to do.
 * - `rejected`    — the backend refused the refresh token (revoked, replayed,
 *                   or past its chain lifetime). Only re-authorization fixes
 *                   this, so the session should be surfaced as expired.
 * - `unavailable` — nothing to renew with: an account that logged in before
 *                   refresh tokens existed, or a backend that doesn't issue
 *                   them. Falls back to the pre-renewal behaviour (expire,
 *                   prompt to reconnect) rather than being an error.
 * - `deferred`    — transient failure; a retry is already scheduled and the
 *                   existing token is still presumed good.
 */
type RefreshOutcome = 'renewed' | 'rejected' | 'unavailable' | 'deferred';

/** One logged-in (bffUrl, user) pair this machine has credentials for —
 * the account registry's storage shape (see ACCOUNTS_KEY). `frontendUrl`/
 * `clientId` are captured at login time so nothing downstream needs a
 * bffUrl→environment reverse lookup for anything functional (only for
 * display, see environmentLabelForBffUrl below). */
interface AccountMetadata {
  id: string;
  bffUrl: string;
  frontendUrl: string;
  clientId: string;
  user: MeUser;
  updatedAt: number;
  /** Wall-clock timestamp (ms) the account's CURRENT access token expires
   * at, from the OAuth token response's `expires_in` — rewritten on every
   * silent renewal, not just at login (see _applyTokenResponse()). This is
   * what the renewal schedule is derived from: _scheduleRefresh() aims at
   * `expiresAt - REFRESH_SKEW_MS`. Absent if the token response omitted
   * expires_in, in which case renewal falls back to being purely reactive
   * (a 401 via reportUnauthorized()) since there's no deadline to aim at. */
  expiresAt?: number;
}

/** Best-effort, display-only label for the account switcher — doesn't need
 * to be exact, so a custom/advanced bffUrl that matches no known environment
 * just falls back to showing the raw URL. */
function environmentLabelForBffUrl(bffUrl: string): string {
  const match = Object.entries(ENVIRONMENTS).find(([, defaults]) => defaults.bffUrl === bffUrl);
  if (!match) return bffUrl;
  const [environment] = match;
  return environment === 'production' ? 'Production' : environment;
}

/** Turns an OAuth `expires_in` (seconds from now) into the wall-clock
 * timestamp stored on AccountMetadata. Undefined for a response that omitted
 * it or sent something unusable, which callers read as "expiry unknown". */
function expiresAtFrom(expiresIn: unknown): number | undefined {
  return typeof expiresIn === 'number' && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined;
}

/**
 * Manages OAuth device flow and multi-account credential storage for the
 * Actorium Agent.
 *
 * Flow (per account):
 * 1. POST /oauth/device → get user_code + verification_uri
 * 2. Open browser to bffUrl + verification_uri + ?user_code=...
 * 3. Poll POST /oauth/token until success or timeout
 * 4. Fetch /api/me to learn the account's identity, then store everything
 *    keyed by the resulting accountId (`${bffUrl}|${user.id}`).
 *
 * These endpoints are handled in-process by workflow-bff itself (not
 * proxied to user-service), registered at a plain /oauth prefix off the
 * bare BFF origin — see workflow-bff's internal/app/api/server/server.go
 * and internal/app/api/handler/deviceauth.
 *
 * Multiple accounts (any combination of same-backend and cross-backend
 * logins) can be stored and stay signed in simultaneously — switching the
 * active one is a pure local operation (no re-auth), see switchAccount().
 * Two independent things are scoped differently, on purpose:
 *   - org/workspace selection is scoped per ACCOUNT (two accounts can share
 *     a bffUrl and need independent workspace picks) — see scopedByAccount().
 *   - "which account is active" is scoped per (folder, bffUrl) — one
 *     folder/window can point at several bffUrls over its lifetime (see
 *     switchEnvironment()), and each remembers its own last-active account
 *     for that folder independently — see scopedByBffUrl().
 * The account registry itself (ACCOUNTS_KEY) and each account's token are
 * global (globalState/secrets), so any window can switch to an account
 * another window logged into — though not live: globalState has no
 * change-notification API, so a second window only picks up a new account
 * the next time it opens the switcher or re-syncs, not instantly.
 *
 * Sessions renew themselves. The device flow returns a rotating refresh
 * token alongside the access token; the active account's is exchanged for a
 * fresh access token shortly before the current one expires
 * (_scheduleRefresh), on demand if a caller needs a token that is already
 * near expiry (getToken), and reactively if the backend rejects one
 * (reportUnauthorized). The user is only asked to reconnect once renewal is
 * genuinely impossible — the refresh token was revoked, replayed, or its
 * chain hit the absolute lifetime the backend caps it at.
 *
 * Because refresh tokens are single-use, renewal is coalesced within a
 * window (_refreshInFlight) and synchronised across windows by listening to
 * SecretStorage.onDidChange (_onSecretChanged), which is the only
 * cross-window notification available here.
 */
export class AuthManager {
  private _token: string | null = null;
  private _selectedWorkspaceId: string | null = null;
  private _selectedWorkspaceLabel: string | null = null;
  private _selectedOrgId: string | null = null;
  private _userProfile: MeUser | null = null;
  private _activeAccountId: string | null = null;
  /** Whether the active account's session is known to be stale — reached
   * only once silent renewal has been ruled out: either the backend rejected
   * the refresh token outright, or there was none to try (see
   * RefreshOutcome). Reset to false on every fresh activation
   * (_activateAccount) and on every successful renewal. Recovering from here
   * requires reconnectActiveAccount(). */
  private _sessionExpired = false;
  private _pollTimer: NodeJS.Timeout | null = null;
  /** Proactive renewal timer for the ACTIVE account — always at most one,
   * re-armed after every renewal and cleared whenever no account is active
   * (see _scheduleRefresh/_clearRefreshTimer). */
  private _refreshTimer: NodeJS.Timeout | null = null;
  /** The renewal currently in flight, if any, tagged with the account it
   * belongs to. Refresh tokens are single-use and rotate on every exchange,
   * so two concurrent renewals of the same account would spend the same
   * token twice — one would be served by the backend's reuse grace and the
   * other might not. Every caller (the timer, getToken(), a 401) shares this
   * one promise instead. Tagged by account so a switch mid-flight can't let
   * the old account's result land on the new one. */
  private _refreshInFlight: { accountId: string; promise: Promise<RefreshOutcome> } | null = null;
  private _secretsListener: vscode.Disposable | null = null;
  /** Set by dispose(). Async work already in flight (a renewal, a secret-change
   * handler) can outlive it and would otherwise arm a fresh timer on the way
   * out, resurrecting a manager the extension host has already torn down. */
  private _disposed = false;
  private _onConnected: (() => void) | null = null;
  private _onDisconnected: (() => void) | null = null;
  private _onWorkspaceChanged: ((label: string | null) => void) | null = null;
  private _onProfileChanged: ((profile: MeUser | null) => void) | null = null;
  private _onSessionExpired: (() => void) | null = null;
  private _onSessionRestored: (() => void) | null = null;

  /**
   * The backend this window is currently pointed at (`actorium.bffUrl`,
   * defaulted from `actorium.environment` — see config/environment.ts).
   * Switching account can change this (each account has its own bffUrl);
   * switching environment (switchEnvironment()) restores whichever account
   * this folder/window last used for the new bffUrl, if any.
   */
  private _bffUrl: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    bffUrl: string,
  ) {
    this._bffUrl = bffUrl;
    // No account activated yet — autoConnect() (called by extension.ts right
    // after construction) resolves and restores whichever account this
    // folder (or, failing that, this machine) last used for this bffUrl.
    // Nothing to do synchronously here since that requires an async
    // context.secrets read.

    // SecretStorage is shared by every window in this VS Code install, and
    // onDidChange fires across them — the only cross-window signal available
    // here (globalState has none, see the class doc comment). Renewal
    // rotates the stored token, so without this a second window would keep
    // presenting the copy it read at activation until that copy expired.
    this._secretsListener = this.context.secrets.onDidChange((e) => {
      void this._onSecretChanged(e.key);
    });
  }

  /** Disposes the timers and listener this manager owns. Registered into the
   * extension's subscriptions so an extension-host reload doesn't leave a
   * renewal timer firing against a dead AuthManager. */
  dispose(): void {
    this._disposed = true;
    this._stopPolling();
    this._clearRefreshTimer();
    this._secretsListener?.dispose();
    this._secretsListener = null;
  }

  /** Picks up an access token another window rotated out from under us.
   * Only the ACTIVE account matters — an inactive account's token is read
   * fresh from secrets by _activateAccount when it next becomes active. */
  private async _onSecretChanged(key: string): Promise<void> {
    const accountId = this._activeAccountId;
    if (this._disposed || !accountId || key !== this._secretKey(accountId)) return;

    const token = await this.context.secrets.get(key);
    if (this._disposed) return;
    // Gone rather than changed means another window signed this account out.
    // Left alone deliberately: _activateAccount already self-heals that on
    // the next activation, and tearing down an in-use session from a
    // background event would be a surprising way to find out.
    if (!token || token === this._token) return;

    this._token = token;
    await this._syncCredentialFile();
    // The other window renewed, so whatever made this one think it was
    // expired no longer holds.
    if (this._sessionExpired) {
      this._sessionExpired = false;
      this._onSessionRestored?.();
    }
    this._scheduleRefresh();
  }

  /** Scopes a storage key to the currently ACTIVE account — used for
   * org/workspace selection, which must stay independent across accounts
   * that share the same bffUrl. */
  private scopedByAccount(base: string): string {
    return this._keyForAccount(base, this._activeAccountId ?? '');
  }

  private _keyForAccount(base: string, accountId: string): string {
    return `${base}::${accountId}`;
  }

  /** Scopes a storage key to the currently selected BACKEND — used for the
   * per-folder "which account is active for this bffUrl" pointer. */
  private scopedByBffUrl(base: string): string {
    return `${base}::${this._bffUrl}`;
  }

  private _secretKey(accountId: string): string {
    return `${SECRET_KEY_PREFIX}::${accountId}`;
  }

  /** Where an account's rotating refresh token lives. Kept in secrets
   * alongside the access token rather than in the registry: it is a
   * longer-lived credential than the access token it mints, so it has even
   * less business sitting in plaintext globalState. */
  private _refreshSecretKey(accountId: string): string {
    return `${REFRESH_SECRET_KEY_PREFIX}::${accountId}`;
  }

  private _computeAccountId(bffUrl: string, userId: string): string {
    return `${bffUrl}|${userId}`;
  }

  private _readRegistry(): Record<string, AccountMetadata> {
    return this.context.globalState.get<Record<string, AccountMetadata>>(ACCOUNTS_KEY) ?? {};
  }

  /** Re-reads the registry immediately before writing to shrink (not
   * eliminate) the window for a lost update if two windows log into two
   * different new accounts at the same instant — globalState has no atomic
   * read-modify-write primitive. Accepted as a rare, user-initiated-action
   * race rather than something worth a lock for. */
  private async _writeRegistryEntry(meta: AccountMetadata): Promise<void> {
    const registry = this._readRegistry();
    registry[meta.id] = meta;
    await this.context.globalState.update(ACCOUNTS_KEY, registry);
  }

  private _readLastActiveByBffUrl(): Record<string, string> {
    return this.context.globalState.get<Record<string, string>>(LAST_ACTIVE_BY_BFFURL_KEY) ?? {};
  }

  private async _writeLastActiveForBffUrl(bffUrl: string, accountId: string): Promise<void> {
    const map = this._readLastActiveByBffUrl();
    map[bffUrl] = accountId;
    await this.context.globalState.update(LAST_ACTIVE_BY_BFFURL_KEY, map);
  }

  /**
   * Registers a callback fired once a device-flow connection completes
   * (polling picked up a token), or an account switch/sign-out-with-fallback
   * makes a different account active. autoConnect() on activation does NOT
   * fire this — callers should check its return value directly for that case.
   */
  onConnected(callback: () => void): void {
    this._onConnected = callback;
  }

  /** Registers a callback fired on disconnect() when no fallback account is
   * available (i.e. the window actually ends up signed out). */
  onDisconnected(callback: () => void): void {
    this._onDisconnected = callback;
  }

  /**
   * Registers a callback fired whenever the active account's selected
   * workspace changes (switchWorkspace() picks one, switching/adding/signing
   * out of an account restores or clears one, disconnect() with no fallback
   * clears it to null).
   */
  onWorkspaceChanged(callback: (label: string | null) => void): void {
    this._onWorkspaceChanged = callback;
  }

  /**
   * Registers a callback fired whenever the active account's cached user
   * profile changes (populated after connecting/switching account, cleared
   * on disconnect with no fallback).
   */
  onProfileChanged(callback: (profile: MeUser | null) => void): void {
    this._onProfileChanged = callback;
  }

  /**
   * Registers a callback fired once when the active account's session
   * transitions from valid to expired (see reportUnauthorized()/
   * checkExpiry()) — a one-shot nudge callers use to prompt the user to
   * reconnect (e.g. a native "Session expired — Reconnect?" toast). Does NOT
   * fire again until the session recovers (a fresh activation resets the
   * flag) and re-expires. For ongoing UI state (a persistent banner), callers
   * should read isSessionExpired() directly rather than relying on this
   * firing exactly once per render.
   */
  onSessionExpired(callback: () => void): void {
    this._onSessionExpired = callback;
  }

  /** Whether the active account's session is currently known to be stale —
   * see the field's own doc comment. */
  isSessionExpired(): boolean {
    return this._sessionExpired;
  }

  /**
   * Returns the active account's last-fetched user profile (name/email/
   * avatar), or null if none. Populated as a side effect of _fetchOrgs —
   * primed fire-and-forget on connect/autoConnect/switch, refreshed on
   * switchWorkspace.
   */
  getUserProfile(): MeUser | null {
    return this._userProfile;
  }

  /** Returns the id of the currently active account (see switchAccount()),
   * or null if none — used to stash which account initiated a workspace
   * switch that reopens the window into a different folder (see
   * workspace/folderManager.ts's PendingWorkspaceSync). */
  getActiveAccountId(): string | null {
    return this._activeAccountId;
  }

  /** Returns the active account's own bffUrl. */
  getBffUrl(): string {
    return this._bffUrl;
  }

  /** Returns the active account's own frontend URL (captured at that
   * account's login time), or null if no account is active — used for
   * "Profile settings" links instead of the globally-selected environment's
   * frontendUrl, since the active account isn't necessarily on that
   * environment. */
  getFrontendUrl(): string | null {
    if (!this._activeAccountId) return null;
    return this._readRegistry()[this._activeAccountId]?.frontendUrl ?? null;
  }

  /**
   * Registers a callback fired when a session that was surfaced as expired
   * becomes usable again WITHOUT the user doing anything — another window
   * renewed the shared token (see _onSecretChanged). Callers use it to take
   * the "session expired" banner back down. A renewal that succeeds before
   * anything was surfaced never fires this, because nothing was shown.
   */
  onSessionRestored(callback: () => void): void {
    this._onSessionRestored = callback;
  }

  /**
   * Reports a REAL 401 from the backend (see workflow-api.ts's authedFetch,
   * and _fetchOrgs/_fetchWorkspaces below) — a token the backend rejected
   * even though our own clock still thought it was valid (revocation, clock
   * skew, a shorter server-side TTL than the original expires_in).
   *
   * Attempts one silent renewal first and only surfaces the session as
   * expired if that doesn't produce a working token; the request that
   * triggered this has already failed either way, so the recovery shows up
   * on the next poll rather than retroactively. Fire-and-forget by design —
   * authedFetch reports the 401 and moves on rather than awaiting a renewal
   * mid-request.
   *
   * No-ops if already marked expired (so repeated failures don't re-fire
   * onSessionExpired) or if no account is active.
   */
  reportUnauthorized(): void {
    if (!this._activeAccountId || this._sessionExpired) return;
    void this._refreshAccessToken().then((outcome) => {
      // Anything short of a fresh token leaves the 401 standing. `deferred`
      // is included deliberately: a transient renewal failure doesn't undo
      // the backend having just told us this token is no good.
      if (outcome !== 'renewed') this._markSessionExpired();
    });
  }

  /**
   * Re-derives the active account's session state from the clock, renewing
   * silently if the access token is at or near its expiry and surfacing the
   * session as expired only if renewal isn't possible.
   *
   * Called on every activation (_activateAccount) — so a token that expired
   * while VS Code was closed is renewed at startup rather than on the first
   * failed request — and periodically while a session stays active (see
   * NavigatorPanelProvider's poll loop, panel.ts). The periodic call is a
   * safety net, not the primary mechanism: renewal is normally driven by
   * _scheduleRefresh()'s timer. It earns its keep when that timer can't be
   * trusted — a laptop resumed from sleep, where the timer was frozen and
   * the wall clock jumped hours ahead.
   *
   * Named for its original clock-checking role and kept synchronous so its
   * existing callers are unaffected; the renewal it may start runs in the
   * background.
   */
  checkExpiry(): void {
    void this._ensureFreshSession();
  }

  /**
   * The single "make the active session usable" path: renew now if the token
   * is spent or nearly so, otherwise just make sure a timer is armed for
   * when it will be.
   */
  private async _ensureFreshSession(): Promise<void> {
    if (!this._activeAccountId) return;
    if (!this._needsRefresh()) {
      this._scheduleRefresh();
      return;
    }
    const outcome = await this._refreshAccessToken();
    // `deferred` schedules its own retry and leaves the current token in
    // place; `renewed` re-arms the timer from the new expiry. The remaining
    // two mean renewal is off the table for this account.
    if (outcome === 'rejected' || outcome === 'unavailable') this._markExpiredIfStale();
  }

  /** Whether the active account's access token is inside the renewal window
   * (or already past expiry). False when the token's expiry is unknown —
   * there's no deadline to act on, so renewal stays purely reactive. */
  private _needsRefresh(): boolean {
    if (!this._activeAccountId) return false;
    const expiresAt = this._readRegistry()[this._activeAccountId]?.expiresAt;
    if (expiresAt === undefined) return false;
    return Date.now() >= expiresAt - REFRESH_SKEW_MS;
  }

  /** Surfaces the session as expired, but only once the access token really
   * is past its expiry. A renewal that fails inside the skew window leaves a
   * token that still works for several more minutes, and telling the user to
   * reconnect while their session is demonstrably fine would be wrong. */
  private _markExpiredIfStale(): void {
    if (!this._activeAccountId) return;
    const expiresAt = this._readRegistry()[this._activeAccountId]?.expiresAt;
    if (expiresAt !== undefined && Date.now() < expiresAt) return;
    this._markSessionExpired();
  }

  private _markSessionExpired(): void {
    if (!this._activeAccountId || this._sessionExpired) return;
    this._sessionExpired = true;
    this._onSessionExpired?.();
  }

  /**
   * Renews the active account's access token, coalescing concurrent callers
   * onto a single exchange — see _refreshInFlight for why that matters with
   * single-use rotating tokens.
   */
  private async _refreshAccessToken(): Promise<RefreshOutcome> {
    const accountId = this._activeAccountId;
    if (!accountId) return 'unavailable';
    if (this._refreshInFlight?.accountId === accountId) return this._refreshInFlight.promise;

    const promise = this._exchangeRefreshToken(accountId).finally(() => {
      if (this._refreshInFlight?.accountId === accountId) this._refreshInFlight = null;
    });
    this._refreshInFlight = { accountId, promise };
    return promise;
  }

  /**
   * One refresh_token exchange against the account's own backend (see
   * workflow-bff's internal/app/api/handler/deviceauth). The response carries
   * a NEW refresh token that replaces the one just spent — the presented one
   * is dead the moment the backend accepts it, so the replacement is stored
   * before anything else can be reported as successful.
   */
  private async _exchangeRefreshToken(accountId: string): Promise<RefreshOutcome> {
    const meta = this._readRegistry()[accountId];
    if (!meta) return 'unavailable';

    const refreshToken = await this.context.secrets.get(this._refreshSecretKey(accountId));
    if (!refreshToken) return 'unavailable';

    let resp: Response;
    try {
      resp = await fetch(`${meta.bffUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: meta.clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
    } catch {
      // Offline, DNS failure, timeout — the request never reached the
      // backend, so the refresh token was NOT spent and is still good. Back
      // off and try again rather than burning it or alarming the user.
      this._scheduleRefresh(REFRESH_RETRY_MS);
      return 'deferred';
    }

    if (resp.status >= 500) {
      this._scheduleRefresh(REFRESH_RETRY_MS);
      return 'deferred';
    }

    if (!resp.ok) {
      // A 4xx is the backend's final answer: the token is revoked, was
      // replayed, or its chain has run out (see refreshtoken's package doc).
      // Drop it so nothing keeps retrying with a credential that can only
      // fail — only reconnectActiveAccount() recovers from here.
      await this.context.secrets.delete(this._refreshSecretKey(accountId));
      return 'rejected';
    }

    let tokenData: TokenResponse;
    try {
      tokenData = (await resp.json()) as TokenResponse;
    } catch {
      this._scheduleRefresh(REFRESH_RETRY_MS);
      return 'deferred';
    }
    if (!tokenData.access_token) {
      this._scheduleRefresh(REFRESH_RETRY_MS);
      return 'deferred';
    }

    await this._applyTokenResponse(accountId, meta, tokenData);

    // A switch or sign-out may have landed while this was in flight; the new
    // tokens are stored against their own account either way, but none of
    // this window's live state belongs to them any more.
    if (this._activeAccountId !== accountId) return 'renewed';

    this._token = tokenData.access_token;
    this._sessionExpired = false;
    await this._syncCredentialFile();
    this._scheduleRefresh();
    return 'renewed';
  }

  /**
   * Persists a token response's access token, rotated refresh token and new
   * expiry for `accountId` — the one place tokens are written, shared by a
   * fresh login and a renewal.
   *
   * `updatedAt` is deliberately left untouched: it orders the account
   * switcher by recent USE and picks the fallback account on sign-out, and a
   * background renewal is not the user doing anything. Letting it tick would
   * silently reshuffle that list on a timer.
   */
  private async _applyTokenResponse(
    accountId: string,
    meta: AccountMetadata,
    tokenData: TokenResponse,
  ): Promise<void> {
    await this.context.secrets.store(this._secretKey(accountId), tokenData.access_token);
    // Absent only when the backend predates refresh tokens or has them
    // disabled; keeping the previous value would mean re-presenting a token
    // that was just spent, so it's cleared instead.
    if (tokenData.refresh_token) {
      await this.context.secrets.store(this._refreshSecretKey(accountId), tokenData.refresh_token);
    } else {
      await this.context.secrets.delete(this._refreshSecretKey(accountId));
    }
    await this._writeRegistryEntry({
      ...meta,
      expiresAt: expiresAtFrom(tokenData.expires_in),
    });
  }

  /**
   * Arms the proactive renewal timer for the active account. With no
   * explicit delay it aims at REFRESH_SKEW_MS before the access token's
   * expiry, clamped into [MIN_REFRESH_DELAY_MS, MAX_TIMER_DELAY_MS].
   *
   * A clamp to the ceiling isn't a problem: the timer simply fires early,
   * finds the token still fresh, and re-arms.
   */
  private _scheduleRefresh(explicitDelayMs?: number): void {
    this._clearRefreshTimer();
    const accountId = this._activeAccountId;
    if (this._disposed || !accountId) return;

    let delay = explicitDelayMs;
    if (delay === undefined) {
      const expiresAt = this._readRegistry()[accountId]?.expiresAt;
      // No known expiry — nothing to aim at. Renewal stays reactive (a 401
      // via reportUnauthorized) rather than polling on a made-up interval.
      if (expiresAt === undefined) return;
      delay = expiresAt - Date.now() - REFRESH_SKEW_MS;
    }
    delay = Math.min(Math.max(delay, MIN_REFRESH_DELAY_MS), MAX_TIMER_DELAY_MS);

    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      void this._ensureFreshSession();
    }, delay);
  }

  private _clearRefreshTimer(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  /**
   * Tells the backend to invalidate a refresh token and everything rotated
   * from the same login, so signing out drops the ability to renew right
   * away instead of leaving a working credential on the server until its
   * chain expires. Best-effort: the local sign-out has already happened and
   * must not fail or stall because the network is down.
   *
   * Note this cannot revoke the access token itself — that JWT is stateless
   * and stays valid until its own expiry.
   */
  private async _revokeRefreshToken(bffUrl: string, refreshToken: string): Promise<void> {
    try {
      await fetch(`${bffUrl}/oauth/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
    } catch {
      // Offline sign-out still signs out locally; the chain expires on its
      // own eventually.
    }
  }

  /**
   * Re-authenticates the CURRENTLY ACTIVE account in place — the "Reconnect"
   * action for when its session has expired (see onSessionExpired/
   * reportUnauthorized/checkExpiry). Reuses the account's own cached
   * bffUrl/frontendUrl/clientId (captured at its original login) and the
   * same device flow as a brand-new login; since accountId is derived from
   * (bffUrl, user.id), a successful re-auth updates this SAME registry
   * entry/secret in place rather than creating a duplicate — see
   * _completeLogin's upsert.
   */
  async reconnectActiveAccount(): Promise<void> {
    if (!this._activeAccountId) {
      vscode.window.showWarningMessage('Actorium: Connect first.');
      return;
    }
    const meta = this._readRegistry()[this._activeAccountId];
    if (!meta) {
      vscode.window.showWarningMessage(
        'Actorium: That account is no longer available — please add it again.',
      );
      return;
    }
    await this._runDeviceFlow(meta.bffUrl, meta.frontendUrl, meta.clientId);
  }

  /**
   * All accounts this machine has stored credentials for, most-recently-used
   * first — cached data only, no network calls (accounts can span different
   * backends, so there's no single config to fetch a fresh list through).
   * workspaceLabel is best-effort and folder-local: an account switched to
   * for the first time in this folder/window shows null until switchWorkspace()
   * or a restored selection populates it.
   */
  listAccounts(): AccountSummary[] {
    const registry = this._readRegistry();
    return Object.values(registry)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((meta) => ({
        id: meta.id,
        bffUrl: meta.bffUrl,
        environmentLabel: environmentLabelForBffUrl(meta.bffUrl),
        user: meta.user,
        workspaceLabel:
          meta.id === this._activeAccountId
            ? this._selectedWorkspaceLabel
            : (this.context.workspaceState.get<string>(
                this._keyForAccount(WORKSPACE_LABEL_KEY, meta.id),
              ) ?? null),
        isActive: meta.id === this._activeAccountId,
      }));
  }

  /**
   * Attempt to restore a stored account on activation. Resolves this
   * folder's own "last active account for the current bffUrl" pointer,
   * falling back to the machine-wide last-active-for-this-bffUrl if this
   * folder has never used it (e.g. a brand-new folder on a bffUrl this
   * machine already has an account for). Returns true if an account was
   * restored. Does NOT fire onConnected — callers should check the return
   * value directly (mirrors the single-account version's original contract).
   */
  async autoConnect(): Promise<boolean> {
    const folderAccountId = this.context.workspaceState.get<string>(
      this.scopedByBffUrl(ACTIVE_ACCOUNT_KEY),
    );
    const candidateId = folderAccountId ?? this._readLastActiveByBffUrl()[this._bffUrl];
    if (!candidateId) return false;

    const activated = await this._activateAccount(candidateId);
    if (!activated) return false;

    // Fire-and-forget: refreshes the cached profile without blocking
    // activation on it — _fetchOrgs stashes the profile (and the registry
    // entry) as a side effect and notifies via onProfileChanged whenever it
    // resolves.
    void this._fetchOrgs().catch(() => {});
    return true;
  }

  /**
   * Returns the current JWT token, or null if not authenticated — renewing
   * first if it is already inside the expiry window, so callers never send a
   * token that is about to be (or already has been) refused.
   *
   * The renewal is coalesced, so a burst of concurrent API calls triggers
   * one exchange, not one each. A failed renewal still returns the existing
   * token: it may have minutes of life left, and letting the request try and
   * get a real 401 is better than pre-emptively failing it here.
   */
  async getToken(): Promise<string | null> {
    if (this._needsRefresh()) await this._refreshAccessToken();
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
   * Loads accountId's cached profile/org/workspace from storage into the
   * in-memory "current" fields, restores its token from secrets, and
   * persists this window's active-account pointer for the account's bffUrl —
   * self-healing (pruning the registry entry and returning false, leaving
   * all in-memory state untouched) if the secret is missing (e.g. another
   * window signed this account out, or it was removed from the OS keychain
   * externally). Does NOT fire onConnected/onProfileChanged/onWorkspaceChanged
   * — callers that need those (switchAccount, applyPendingWorkspaceSelection,
   * a fresh login, disconnect's fallback) fire them once they've decided this
   * is a user-visible change, not just startup restoration.
   */
  private async _activateAccount(accountId: string): Promise<boolean> {
    const registry = this._readRegistry();
    const meta = registry[accountId];
    if (!meta) return false;

    const token = await this.context.secrets.get(this._secretKey(accountId));
    if (!token) {
      delete registry[accountId];
      await this.context.globalState.update(ACCOUNTS_KEY, registry);
      return false;
    }

    this._activeAccountId = accountId;
    this._bffUrl = meta.bffUrl;
    this._token = token;
    this._userProfile = meta.user;
    this._sessionExpired = false;
    this._selectedWorkspaceId =
      this.context.workspaceState.get<string>(this.scopedByAccount(WORKSPACE_ID_KEY)) ?? null;
    this._selectedWorkspaceLabel =
      this.context.workspaceState.get<string>(this.scopedByAccount(WORKSPACE_LABEL_KEY)) ?? null;
    this._selectedOrgId =
      this.context.workspaceState.get<string>(this.scopedByAccount(ORG_ID_KEY)) ?? null;

    await this.context.workspaceState.update(this.scopedByBffUrl(ACTIVE_ACCOUNT_KEY), accountId);
    await this._writeLastActiveForBffUrl(meta.bffUrl, accountId);
    await this._syncCredentialFile();
    // Renew (or schedule renewal) right away — catches a token that expired
    // while VS Code was closed, or while a different account was active,
    // instead of waiting for the first failed request. Not awaited: an
    // activation must not block on the network, and getToken() will join the
    // same in-flight renewal if something needs a token before it lands.
    void this._ensureFreshSession();
    return true;
  }

  /**
   * Overrides whatever this folder's own workspaceState currently points at,
   * activating `accountId` first (mirrors _activateAccount's restore path) —
   * a reload into a BRAND-NEW folder has no activeAccountId::<bffUrl>
   * pointer yet for that folder, so autoConnect() would have nothing to
   * restore from even though the reload was triggered by an already-active
   * account. The stash/consume mechanism (see folderManager.ts) is the only
   * thing that knows which account made this selection, hence the explicit
   * accountId param. No-ops if that account's secret is gone (self-healed
   * away by _activateAccount) — the folder just opens without a restored
   * session rather than throwing.
   */
  async applyPendingWorkspaceSelection(
    accountId: string,
    workspaceId: string,
    workspaceLabel: string,
    orgId: string | null,
  ): Promise<void> {
    const activated = await this._activateAccount(accountId);
    if (!activated) return;

    this._selectedWorkspaceId = workspaceId;
    this._selectedWorkspaceLabel = workspaceLabel;
    this._selectedOrgId = orgId;
    await this.context.workspaceState.update(this.scopedByAccount(WORKSPACE_ID_KEY), workspaceId);
    await this.context.workspaceState.update(
      this.scopedByAccount(WORKSPACE_LABEL_KEY),
      workspaceLabel,
    );
    await this.context.workspaceState.update(this.scopedByAccount(ORG_ID_KEY), orgId ?? undefined);
    await this._syncCredentialFile();

    vscode.commands.executeCommand('setContext', 'actorium.connected', true);
    this._onConnected?.();
    this._onProfileChanged?.(this._userProfile);
    this._onWorkspaceChanged?.(this._selectedWorkspaceLabel);
  }

  /**
   * Initiate the OAuth device flow for the globally-selected environment
   * (see config/environment.ts) — the plain "Connect" path, used both for a
   * brand-new login and for re-authenticating an account that already
   * exists (the resulting accountId is the same, so it's updated in place
   * rather than duplicated).
   */
  async startDeviceFlow(): Promise<void> {
    const { bffUrl, frontendUrl, clientId } = getActoriumConfig();
    await this._runDeviceFlow(bffUrl, frontendUrl, clientId);
  }

  /**
   * Initiate the OAuth device flow for an explicit (bffUrl, frontendUrl,
   * clientId) — the "Add another account" path. Deliberately does not go
   * through getActoriumConfig()/the globally-selected environment: the
   * `actorium.bffUrl` advanced override only makes sense as "override the
   * currently-selected environment," not as a silent override of an
   * explicitly-picked new account's backend. On cancel (user dismisses the
   * environment picker before this is even called, see extension.ts's
   * addAnotherAccount()), nothing happens — this window's previously-active
   * account is never touched, since switchEnvironment() is never invoked on
   * this path.
   */
  async startDeviceFlowForNewAccount(
    bffUrl: string,
    frontendUrl: string,
    clientId: string,
  ): Promise<void> {
    await this._runDeviceFlow(bffUrl, frontendUrl, clientId);
  }

  private async _runDeviceFlow(
    bffUrl: string,
    frontendUrl: string,
    clientId: string,
  ): Promise<void> {
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
      await this._pollForToken(bffUrl, frontendUrl, clientId, deviceData.device_code);
    } catch (err) {
      vscode.window.showErrorMessage(`Actorium auth error: ${err}`);
    }
  }

  /**
   * Poll the token endpoint until the user authorizes or the device code expires.
   */
  private async _pollForToken(
    bffUrl: string,
    frontendUrl: string,
    clientId: string,
    deviceCode: string,
  ): Promise<void> {
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
        this._stopPolling();
        await this._completeLogin(bffUrl, frontendUrl, clientId, tokenData);
      } catch (err) {
        this._stopPolling();
        vscode.window.showErrorMessage(`Actorium: Token request error: ${err}`);
      }
    }, POLL_INTERVAL_MS);
  }

  /**
   * Resolves the new token's identity, upserts it into the account registry
   * (in place if this is a re-auth of an existing account), and activates
   * it. Unlike the pre-multi-account version, the profile fetch is no
   * longer optional/fire-and-forget for a brand-new login: accountId is
   * derived from the user's own id, so nothing can be stored until it's
   * known. If the profile fetch fails, the token is discarded (not stored
   * anywhere) rather than left in a half-registered state — the user can
   * just retry.
   */
  private async _completeLogin(
    bffUrl: string,
    frontendUrl: string,
    clientId: string,
    tokenData: TokenResponse,
  ): Promise<void> {
    const { userServiceUrl } = deriveServiceUrls(bffUrl);
    const token = tokenData.access_token;
    let user: MeUser;
    try {
      const resp = await fetch(`${userServiceUrl}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`Failed to fetch profile (${resp.status})`);
      const body = (await resp.json()) as ApiSuccessResponse<MeResponse>;
      user = body.data.user;
    } catch (err) {
      vscode.window.showErrorMessage(
        `Actorium: Connected, but failed to load your profile — please try again. (${err})`,
      );
      return;
    }

    const accountId = this._computeAccountId(bffUrl, user.id);
    // Unlike a renewal, a login DOES bump updatedAt — it is the user
    // explicitly using this account, which is exactly what that ordering
    // means (see _applyTokenResponse).
    await this._applyTokenResponse(
      accountId,
      { id: accountId, bffUrl, frontendUrl, clientId, user, updatedAt: Date.now() },
      tokenData,
    );
    await this._activateAccount(accountId);

    vscode.window.showInformationMessage(
      `Actorium: Connected as ${user.display_name || user.email}.`,
    );
    vscode.commands.executeCommand('setContext', 'actorium.connected', true);
    this._onConnected?.();
    this._onProfileChanged?.(this._userProfile);
    void this._fetchOrgs().catch(() => {});
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Mirrors the active account's current token/org/workspace state to the
   * credential file workflow-mcp reads for its bffUrl (see credentialFile.ts)
   * — called on every state change (connect, switch, workspace switch,
   * disconnect, environment switch) that also touches secrets/workspaceState
   * above. The file is keyed by bffUrl only, with no accountId concept (the
   * CLI has no way to know "which VS Code account" beyond its own API_URL
   * env var) — "last active account for that bffUrl wins the file" is an
   * accepted limitation, not a bug: two windows/accounts both active on the
   * SAME backend will still fight over this one file, same as before
   * multi-account existed.
   */
  private async _syncCredentialFile(): Promise<void> {
    if (!this._token) {
      await deleteCredentialFile(this._bffUrl);
      return;
    }
    await writeCredentialFile({
      accessToken: this._token,
      orgId: this._selectedOrgId ?? undefined,
      workspaceId: this._selectedWorkspaceId ?? undefined,
      bffUrl: this._bffUrl,
      updatedAt: Date.now(),
    });
  }

  /**
   * Signs out of `accountId` (defaults to the currently active account),
   * removing its secret and registry entry everywhere on this machine — not
   * just for this window. If it was this window's active account, falls
   * back to another remaining account (arbitrary pick: most recently used,
   * possibly on a different backend) if one exists, else lands in the
   * disconnected state — mirroring switchEnvironment()'s own "restore if
   * possible, else disconnected" fallback. If no account remains anywhere on
   * this machine for that bffUrl, also drops the machine-wide last-active
   * pointer and deletes the CLI's credential file for it, so nothing stale
   * resolves there.
   */
  async disconnect(accountId?: string): Promise<void> {
    const targetId = accountId ?? this._activeAccountId;
    if (!targetId) return;

    const registry = this._readRegistry();
    const meta = registry[targetId];
    delete registry[targetId];
    await this.context.globalState.update(ACCOUNTS_KEY, registry);

    // Read the refresh token before deleting it — signing out should also
    // kill it server-side, so a copy left in a backup or another machine's
    // keychain can't keep minting access tokens for a signed-out account.
    const refreshToken = await this.context.secrets.get(this._refreshSecretKey(targetId));
    await this.context.secrets.delete(this._secretKey(targetId));
    await this.context.secrets.delete(this._refreshSecretKey(targetId));
    if (meta && refreshToken) void this._revokeRefreshToken(meta.bffUrl, refreshToken);
    await this.context.workspaceState.update(
      this._keyForAccount(WORKSPACE_ID_KEY, targetId),
      undefined,
    );
    await this.context.workspaceState.update(
      this._keyForAccount(WORKSPACE_LABEL_KEY, targetId),
      undefined,
    );
    await this.context.workspaceState.update(this._keyForAccount(ORG_ID_KEY, targetId), undefined);

    if (meta && !Object.values(registry).some((a) => a.bffUrl === meta.bffUrl)) {
      const lastActive = this._readLastActiveByBffUrl();
      if (lastActive[meta.bffUrl] === targetId) {
        delete lastActive[meta.bffUrl];
        await this.context.globalState.update(LAST_ACTIVE_BY_BFFURL_KEY, lastActive);
      }
      await deleteCredentialFile(meta.bffUrl);
    }

    if (targetId !== this._activeAccountId) {
      vscode.window.showInformationMessage('Actorium: Signed out.');
      return;
    }

    this._activeAccountId = null;
    this._token = null;
    this._selectedWorkspaceId = null;
    this._selectedWorkspaceLabel = null;
    this._selectedOrgId = null;
    this._userProfile = null;
    this._sessionExpired = false;
    this._clearRefreshTimer();
    await this.context.workspaceState.update(this.scopedByBffUrl(ACTIVE_ACCOUNT_KEY), undefined);

    const fallback = Object.values(registry).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (fallback && (await this._activateAccount(fallback.id))) {
      vscode.window.showInformationMessage(
        `Actorium: Signed out — switched to ${fallback.user.display_name || fallback.user.email}.`,
      );
      vscode.commands.executeCommand('setContext', 'actorium.connected', true);
      this._onConnected?.();
      this._onProfileChanged?.(this._userProfile);
      this._onWorkspaceChanged?.(this._selectedWorkspaceLabel);
      void this._fetchOrgs().catch(() => {});
      return;
    }

    await this._syncCredentialFile();
    vscode.commands.executeCommand('setContext', 'actorium.connected', false);
    vscode.window.showInformationMessage('Actorium: Disconnected.');
    this._onDisconnected?.();
    this._onWorkspaceChanged?.(null);
    this._onProfileChanged?.(null);
  }

  /**
   * Switches this window's active account to `accountId` — a pure local
   * operation (no network calls, no re-auth) as long as its secret is still
   * present; every stored account stays signed in until explicitly signed
   * out of. No-ops if `accountId` is already active. Self-heals (prunes the
   * registry entry, leaves the current active account untouched, warns) if
   * the account's secret is gone — see _activateAccount.
   */
  async switchAccount(accountId: string): Promise<void> {
    if (accountId === this._activeAccountId) return;

    const activated = await this._activateAccount(accountId);
    if (!activated) {
      vscode.window.showWarningMessage(
        'Actorium: That account is no longer signed in — please add it again.',
      );
      return;
    }

    vscode.commands.executeCommand('setContext', 'actorium.connected', true);
    this._onConnected?.();
    this._onProfileChanged?.(this._userProfile);
    this._onWorkspaceChanged?.(this._selectedWorkspaceLabel);
    void this._fetchOrgs().catch(() => {});
  }

  /**
   * Fetch the caller's org memberships — GET /api/me, the SAME endpoint the
   * browser's own org/workspace switcher uses. Sent as a bearer device-flow
   * JWT; workflow-bff verifies it (bearer-JWT auth is now a blanket
   * alternative to a session cookie on every auth_required route — see
   * workflow-bff's internal/app/api/handler/proxy) and forwards the resolved
   * identity to the real /api/me as trusted headers, identical to the
   * browser/session path. No dedicated /coding/me route is needed anymore.
   * Also refreshes the active account's cached profile in the registry, so
   * listAccounts()/the switcher shows up-to-date name/avatar next time.
   */
  private async _fetchOrgs(): Promise<MeMembership[]> {
    const { userServiceUrl } = deriveServiceUrls(this._bffUrl);

    const resp = await fetch(`${userServiceUrl}/api/me`, {
      headers: { Authorization: `Bearer ${this._token}` },
    });
    if (resp.status === 401) {
      this.reportUnauthorized();
      throw new Error('Session expired — please reconnect.');
    }
    if (!resp.ok) {
      throw new Error(`Failed to list organizations (${resp.status})`);
    }
    const body = (await resp.json()) as ApiSuccessResponse<MeResponse>;
    this._userProfile = body.data.user;
    this._onProfileChanged?.(this._userProfile);

    if (this._activeAccountId) {
      const registry = this._readRegistry();
      const meta = registry[this._activeAccountId];
      if (meta) {
        await this._writeRegistryEntry({ ...meta, user: body.data.user, updatedAt: Date.now() });
      }
    }

    return body.data.memberships;
  }

  /**
   * Fetch the workspaces under a given organization — GET /api/workspaces,
   * the SAME endpoint the browser hits. Sent as a bearer device-flow JWT;
   * workflow-bff verifies it the same blanket way as _fetchOrgs above and
   * forwards to workflow-backend's normal /api/workspaces.
   */
  private async _fetchWorkspaces(orgId: string): Promise<WorkspaceSummary[]> {
    const { workflowBackendUrl } = deriveServiceUrls(this._bffUrl);

    const resp = await fetch(
      `${workflowBackendUrl}/api/workspaces?org=${encodeURIComponent(orgId)}`,
      { headers: { Authorization: `Bearer ${this._token}` } },
    );
    if (resp.status === 401) {
      this.reportUnauthorized();
      throw new Error('Session expired — please reconnect.');
    }
    if (!resp.ok) {
      throw new Error(`Failed to list workspaces (${resp.status})`);
    }
    const body = (await resp.json()) as ApiSuccessResponse<WorkspaceSummary[]>;
    return body.data;
  }

  /**
   * Show the workspace picker — every org's workspaces in one flat list,
   * grouped by org via QuickPick separators — and store the selection for
   * the currently active account. Called automatically on first connect,
   * and available via "Actorium: Switch Workspace" any time after. A prior
   * version mirrored digital-factory-ui's OrgWorkspaceSwitcher popover
   * literally (workspaces of the current org first, with a "Switch
   * organization" row that drilled into a separate org picker) — that
   * two-step hop doesn't earn its keep in a QuickPick the way it does in a
   * popover with two visual panels, so this flattens straight to org >
   * workspace in one list instead. Read-only parity only: no "New
   * workspace"/"Create organization" actions, since those are write
   * operations with no backend calls wired up in the extension yet.
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
    await this.context.workspaceState.update(
      this.scopedByAccount(WORKSPACE_ID_KEY),
      this._selectedWorkspaceId,
    );
    await this.context.workspaceState.update(
      this.scopedByAccount(WORKSPACE_LABEL_KEY),
      this._selectedWorkspaceLabel,
    );
    await this.context.workspaceState.update(this.scopedByAccount(ORG_ID_KEY), this._selectedOrgId);
    await this._syncCredentialFile();
    vscode.window.showInformationMessage(
      `Actorium: Using workspace "${picked.workspace.name}" in "${org.organization_name}".`,
    );
    this._onWorkspaceChanged?.(this._selectedWorkspaceLabel);
  }

  /**
   * Re-scopes this window to a different backend — called when
   * `actorium.environment`/`actorium.bffUrl` changes (see extension.ts).
   * Restores whichever account this folder (or, failing that, this machine)
   * last used for the new bffUrl, silently reconnecting if one exists, or
   * landing in "not connected" if none does — the direct generalization of
   * the pre-multi-account behavior to N accounts per bffUrl. Never touches
   * the PREVIOUS bffUrl's stored accounts/selections — switching back later
   * restores that session too, and no other window pointed at the old
   * backend is affected.
   */
  async switchEnvironment(bffUrl: string): Promise<void> {
    if (bffUrl === this._bffUrl) return;
    this._bffUrl = bffUrl;
    this._activeAccountId = null;
    this._token = null;
    this._selectedWorkspaceId = null;
    this._selectedWorkspaceLabel = null;
    this._selectedOrgId = null;
    this._userProfile = null;
    this._sessionExpired = false;
    // The old backend's renewal timer must not outlive the switch —
    // _activateAccount re-arms one for whichever account this bffUrl
    // restores, if any.
    this._clearRefreshTimer();
    this._onProfileChanged?.(null);

    const folderAccountId = this.context.workspaceState.get<string>(
      this.scopedByBffUrl(ACTIVE_ACCOUNT_KEY),
    );
    const candidateId = folderAccountId ?? this._readLastActiveByBffUrl()[bffUrl];
    const activated = candidateId ? await this._activateAccount(candidateId) : false;

    if (activated) {
      void this._fetchOrgs().catch(() => {});
      vscode.commands.executeCommand('setContext', 'actorium.connected', true);
      this._onConnected?.();
      this._onProfileChanged?.(this._userProfile);
    } else {
      await this._syncCredentialFile();
      vscode.commands.executeCommand('setContext', 'actorium.connected', false);
      this._onDisconnected?.();
    }
    this._onWorkspaceChanged?.(this._selectedWorkspaceLabel);
  }
}
