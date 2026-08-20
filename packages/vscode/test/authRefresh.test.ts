/**
 * Unit tests for AuthManager's silent session renewal (../src/auth/oauth.ts).
 *
 * Everything here runs against a stubbed `vscode` module and a stubbed
 * global fetch — see vscodeStub.ts for why the module under test is imported
 * dynamically rather than at the top of the file. HOME is redirected at load
 * time so the credential-file mirroring AuthManager does on every token
 * change (credentialFile.ts writes under ~/.actorium) lands in a temp dir
 * instead of the developer's real home.
 */

import { ok, strictEqual } from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createContext, createSecrets, installStub } from './vscodeStub.js';

const tempHome = mkdtempSync(join(tmpdir(), 'actorium-authrefresh-test-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const recorder = installStub();

const BFF_URL = 'http://localhost:8090';
const CLIENT_ID = 'actorium-vscode-local';
const USER = { id: 'user-1', email: 'dev@example.com', display_name: 'Dev', avatar_url: '' };
const ACCOUNT_ID = `${BFF_URL}|${USER.id}`;
const ACCESS_SECRET = `actorium.authToken::${ACCOUNT_ID}`;
const REFRESH_SECRET = `actorium.refreshToken::${ACCOUNT_ID}`;
const HOUR_MS = 60 * 60 * 1000;

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

/** A stub for the endpoints AuthManager talks to. Every refresh exchange is
 * recorded so tests can assert on how many actually went out — the whole
 * point of coalescing is that a burst produces exactly one. */
class FakeBackend {
  calls: FetchCall[] = [];
  /** Queued responses for /oauth/token, consumed in order; when empty, a
   * default successful rotation is returned. */
  tokenResponses: Array<() => Promise<Response>> = [];
  private serial = 0;

  get refreshCalls(): FetchCall[] {
    return this.calls.filter((c) => c.body.grant_type === 'refresh_token');
  }

  install(): void {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      this.calls.push({ url, body });

      if (url.endsWith('/oauth/token')) {
        const queued = this.tokenResponses.shift();
        if (queued) return queued();
        return this.rotated();
      }
      if (url.endsWith('/oauth/revoke')) return json(200, { status: 'revoked' });
      if (url.endsWith('/api/me')) return json(200, { success: true, data: { user: USER } });
      return json(404, {});
    }) as typeof fetch;
  }

  /** A successful renewal, with a token pair distinguishable from the last. */
  rotated(expiresIn = 24 * 60 * 60): Promise<Response> {
    this.serial++;
    return json(200, {
      access_token: `access-${this.serial}`,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: `refresh-${this.serial}`,
    });
  }
}

function json(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

type AuthManagerCtor = typeof import('../src/auth/oauth.js').AuthManager;
type AuthManagerInstance = InstanceType<AuthManagerCtor>;

/** Every manager built by a test. AuthManager arms a renewal timer that
 * keeps the event loop alive, so a failed assertion part-way through would
 * otherwise hang the process instead of reporting — they all get disposed in
 * the finally, whatever happened. */
const created: AuthManagerInstance[] = [];

/** Seeds storage with an already-logged-in account whose access token
 * expires `expiresInMs` from now — the state a window restores into, without
 * having to drive a whole device flow first. */
async function seedSignedInAccount(options: {
  AuthManager: AuthManagerCtor;
  expiresInMs: number;
  refreshToken?: string | null;
}): Promise<{ auth: AuthManagerInstance; secrets: ReturnType<typeof createSecrets> }> {
  const secrets = createSecrets();
  const context = createContext(secrets);

  await context.globalState.update('actorium.accounts', {
    [ACCOUNT_ID]: {
      id: ACCOUNT_ID,
      bffUrl: BFF_URL,
      frontendUrl: 'http://localhost:3000',
      clientId: CLIENT_ID,
      user: USER,
      updatedAt: 1000,
      expiresAt: Date.now() + options.expiresInMs,
    },
  });
  await context.globalState.update('actorium.lastActiveAccountByBffUrl', { [BFF_URL]: ACCOUNT_ID });
  await secrets.store(ACCESS_SECRET, 'access-original');
  if (options.refreshToken !== null) {
    await secrets.store(REFRESH_SECRET, options.refreshToken ?? 'refresh-original');
  }

  const auth = new options.AuthManager(context as any, BFF_URL);
  created.push(auth);
  return { auth, secrets };
}

/** Lets fire-and-forget work finish. Generous on purpose: renewal isn't pure
 * async bookkeeping — it mirrors every token change to a real file on disk
 * (credentialFile.ts), so a handful of microtask turns isn't enough. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 1));
}

/** Waits for `predicate` to hold, so a test asserting on the RESULT of
 * background work doesn't depend on guessing how many turns it takes.
 * Returns whether it ever became true, letting the caller assert with its
 * own message. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
}

async function run(): Promise<void> {
  const { AuthManager } = await import('../src/auth/oauth.js');

  // A token comfortably inside its lifetime is used as-is: renewal is
  // scheduled for later, not performed now.
  {
    const backend = new FakeBackend();
    backend.install();
    const { auth } = await seedSignedInAccount({ AuthManager, expiresInMs: 12 * HOUR_MS });

    ok(await auth.autoConnect());
    await settle();

    strictEqual(backend.refreshCalls.length, 0, 'a fresh token should not be renewed');
    strictEqual(await auth.getToken(), 'access-original');
    strictEqual(auth.isSessionExpired(), false);
    auth.dispose();
  }

  // A token that expired while VS Code was closed is renewed at activation,
  // rather than surfacing as an expired session the user has to act on.
  {
    const backend = new FakeBackend();
    backend.install();
    const { auth, secrets } = await seedSignedInAccount({ AuthManager, expiresInMs: -HOUR_MS });

    ok(await auth.autoConnect());
    await settle();

    strictEqual(backend.refreshCalls.length, 1, 'expected exactly one renewal');
    const call = backend.refreshCalls[0];
    ok(call);
    strictEqual(call.url, `${BFF_URL}/oauth/token`);
    strictEqual(call.body.grant_type, 'refresh_token');
    strictEqual(call.body.refresh_token, 'refresh-original');
    strictEqual(call.body.client_id, CLIENT_ID);

    strictEqual(await auth.getToken(), 'access-1', 'the renewed token should be in use');
    strictEqual(auth.isSessionExpired(), false, 'a renewed session is not expired');
    // Rotation means the spent refresh token must not be kept around.
    strictEqual(await secrets.get(REFRESH_SECRET), 'refresh-1');
    auth.dispose();
  }

  // A token inside the renewal skew window is renewed on demand, so no
  // request ever goes out carrying a token about to be refused.
  {
    const backend = new FakeBackend();
    backend.install();
    const { auth } = await seedSignedInAccount({ AuthManager, expiresInMs: 60 * 1000 });

    ok(await auth.autoConnect());
    await settle();

    strictEqual(backend.refreshCalls.length, 1, 'a near-expiry token should be renewed');
    strictEqual(await auth.getToken(), 'access-1');
    auth.dispose();
  }

  // Refresh tokens are single-use, so a burst of concurrent callers must
  // produce ONE exchange — not one each, which would spend a token that is
  // already dead.
  {
    const backend = new FakeBackend();
    backend.install();
    const { auth } = await seedSignedInAccount({ AuthManager, expiresInMs: -HOUR_MS });

    // autoConnect kicks off a renewal of its own without awaiting it, so
    // these four land while that one is still in flight.
    ok(await auth.autoConnect());
    const tokens = await Promise.all([
      auth.getToken(),
      auth.getToken(),
      auth.getToken(),
      auth.getToken(),
    ]);
    await settle();

    strictEqual(backend.refreshCalls.length, 1, 'concurrent renewals must coalesce into one');
    for (const token of tokens) strictEqual(token, 'access-1');
    auth.dispose();
  }

  // A refresh token the backend rejects is unrecoverable — that IS the
  // expired session the user gets prompted about.
  {
    const backend = new FakeBackend();
    backend.install();
    backend.tokenResponses.push(() => json(400, { error: 'invalid_grant' }));
    const { auth, secrets } = await seedSignedInAccount({ AuthManager, expiresInMs: -HOUR_MS });

    let expiredFired = 0;
    auth.onSessionExpired(() => expiredFired++);

    ok(await auth.autoConnect());
    await settle();

    strictEqual(auth.isSessionExpired(), true, 'a rejected refresh means the session is expired');
    strictEqual(expiredFired, 1, 'onSessionExpired should fire exactly once');
    strictEqual(
      await secrets.get(REFRESH_SECRET),
      undefined,
      'a rejected refresh token should be discarded, not retried forever',
    );

    // And with it gone, nothing keeps hammering the endpoint.
    const afterReject = backend.refreshCalls.length;
    auth.checkExpiry();
    await settle();
    strictEqual(backend.refreshCalls.length, afterReject, 'no retry with a discarded token');
    auth.dispose();
  }

  // Being offline is not the same as being signed out: the refresh token was
  // never spent, so the session must not be declared expired.
  {
    const backend = new FakeBackend();
    backend.install();
    backend.tokenResponses.push(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
    const { auth, secrets } = await seedSignedInAccount({ AuthManager, expiresInMs: 60 * 1000 });

    let expiredFired = 0;
    auth.onSessionExpired(() => expiredFired++);

    ok(await auth.autoConnect());
    await settle();

    strictEqual(expiredFired, 0, 'a network failure must not expire a still-valid session');
    strictEqual(auth.isSessionExpired(), false);
    strictEqual(
      await secrets.get(REFRESH_SECRET),
      'refresh-original',
      'an unsent refresh token must be kept for the retry',
    );
    auth.dispose();
  }

  // A 5xx is the server's problem, not the credential's — same treatment.
  {
    const backend = new FakeBackend();
    backend.install();
    backend.tokenResponses.push(() => json(503, { error: 'server_error' }));
    const { auth, secrets } = await seedSignedInAccount({ AuthManager, expiresInMs: 60 * 1000 });

    ok(await auth.autoConnect());
    await settle();

    strictEqual(auth.isSessionExpired(), false);
    strictEqual(await secrets.get(REFRESH_SECRET), 'refresh-original');
    auth.dispose();
  }

  // An account stored before refresh tokens existed has nothing to renew
  // with; it must fall back to the old behaviour rather than erroring.
  {
    const backend = new FakeBackend();
    backend.install();
    const { auth } = await seedSignedInAccount({
      AuthManager,
      expiresInMs: -HOUR_MS,
      refreshToken: null,
    });

    let expiredFired = 0;
    auth.onSessionExpired(() => expiredFired++);

    ok(await auth.autoConnect());
    await settle();

    strictEqual(backend.refreshCalls.length, 0, 'nothing to exchange, so nothing should be sent');
    strictEqual(auth.isSessionExpired(), true);
    strictEqual(expiredFired, 1);
    auth.dispose();
  }

  // A 401 on a token our own clock still trusts gets one silent renewal
  // before the user is bothered.
  {
    const backend = new FakeBackend();
    backend.install();
    const { auth } = await seedSignedInAccount({ AuthManager, expiresInMs: 12 * HOUR_MS });

    let expiredFired = 0;
    auth.onSessionExpired(() => expiredFired++);

    ok(await auth.autoConnect());
    await settle();

    auth.reportUnauthorized();
    await settle();

    strictEqual(backend.refreshCalls.length, 1, 'a 401 should trigger a renewal attempt');
    strictEqual(expiredFired, 0, 'a recovered 401 should not prompt the user');
    strictEqual(auth.isSessionExpired(), false);
    strictEqual(await auth.getToken(), 'access-1');
    auth.dispose();
  }

  // ...but if that renewal is refused, the 401 stands.
  {
    const backend = new FakeBackend();
    backend.install();
    backend.tokenResponses.push(() => json(400, { error: 'invalid_grant' }));
    const { auth } = await seedSignedInAccount({ AuthManager, expiresInMs: 12 * HOUR_MS });

    let expiredFired = 0;
    auth.onSessionExpired(() => expiredFired++);

    ok(await auth.autoConnect());
    await settle();

    auth.reportUnauthorized();
    await settle();

    strictEqual(auth.isSessionExpired(), true);
    strictEqual(expiredFired, 1);
    auth.dispose();
  }

  // Two windows share one SecretStorage. When the other window rotates the
  // token, this one must pick it up instead of presenting a spent copy.
  {
    const backend = new FakeBackend();
    backend.install();
    const { auth, secrets } = await seedSignedInAccount({ AuthManager, expiresInMs: 12 * HOUR_MS });

    ok(await auth.autoConnect());
    await settle();
    strictEqual(await auth.getToken(), 'access-original');

    // Stand-in for the other window's renewal landing in shared storage.
    await secrets.store(ACCESS_SECRET, 'access-from-other-window');
    await settle();

    strictEqual(await auth.getToken(), 'access-from-other-window');
    strictEqual(
      backend.refreshCalls.length,
      0,
      "adopting another window's token needs no exchange",
    );
    auth.dispose();
  }

  // And if this window had already surfaced an expired session, the other
  // window's renewal takes the banner back down.
  {
    const backend = new FakeBackend();
    backend.install();
    backend.tokenResponses.push(() => json(400, { error: 'invalid_grant' }));
    const { auth, secrets } = await seedSignedInAccount({ AuthManager, expiresInMs: -HOUR_MS });

    let restoredFired = 0;
    auth.onSessionRestored(() => restoredFired++);

    ok(await auth.autoConnect());
    await settle();
    strictEqual(auth.isSessionExpired(), true);

    await secrets.store(ACCESS_SECRET, 'access-from-other-window');
    ok(
      await waitFor(() => !auth.isSessionExpired()),
      'the session should recover without user action',
    );

    strictEqual(restoredFired, 1);
    auth.dispose();
  }

  // Signing out must kill the refresh token server-side too, or a copy of it
  // could keep minting access tokens for an account the user just left.
  {
    const backend = new FakeBackend();
    backend.install();
    const { auth, secrets } = await seedSignedInAccount({ AuthManager, expiresInMs: 12 * HOUR_MS });

    ok(await auth.autoConnect());
    await settle();

    await auth.disconnect();
    await settle();

    const revokes = backend.calls.filter((c) => c.url.endsWith('/oauth/revoke'));
    strictEqual(revokes.length, 1, 'sign-out should revoke the refresh token');
    strictEqual(revokes[0]?.body.refresh_token, 'refresh-original');
    strictEqual(await secrets.get(REFRESH_SECRET), undefined);
    strictEqual(await secrets.get(ACCESS_SECRET), undefined);
    auth.dispose();
  }

  // Sign-out is a local action; it must complete even with no network.
  {
    const backend = new FakeBackend();
    backend.install();
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const { auth, secrets } = await seedSignedInAccount({ AuthManager, expiresInMs: 12 * HOUR_MS });

    await (auth as any)._activateAccount(ACCOUNT_ID);
    await auth.disconnect();
    await settle();

    strictEqual(await secrets.get(ACCESS_SECRET), undefined, 'offline sign-out still signs out');
    strictEqual(await secrets.get(REFRESH_SECRET), undefined);
    auth.dispose();
  }

  strictEqual(recorder.errors.length, 0, `unexpected error toasts: ${recorder.errors.join(' | ')}`);
  console.log('✅ AuthManager session renewal tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const auth of created) auth.dispose();
    rmSync(tempHome, { recursive: true, force: true });
  });
