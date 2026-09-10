/**
 * Unit tests for the per-backend credential file writer/deleter (see
 * ../src/auth/credentialFile.ts) — the file workflow-mcp reads per-request
 * so a local coding agent's MCP tool calls authenticate without any manual
 * cookie/token setup. Points HOME at a throwaway temp dir (os.homedir()
 * respects $HOME on POSIX) rather than touching the real ~/.actorium.
 */

import { deepStrictEqual, notDeepStrictEqual, ok } from 'assert';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  accountKeyFor,
  deleteAccountCredentialFile,
  deleteCredentialFile,
  writeCredentialFile,
} from '../src/auth/credentialFile.js';

const realHome = process.env.HOME;
const tempHome = mkdtempSync(join(tmpdir(), 'actorium-credfile-test-'));
process.env.HOME = tempHome;

const actoriumDir = join(tempHome, '.actorium');

/** Mirrors credentialFile.ts's own filename derivation, so tests can find
 * the file for a given backend without depending on internals. */
function credentialPathFor(bffUrl: string): string {
  const key = createHash('sha256').update(bffUrl).digest('hex').slice(0, 16);
  return join(actoriumDir, `auth.${key}.json`);
}

function accountCredentialPathFor(bffUrl: string, accountId: string): string {
  const key = createHash('sha256').update(bffUrl).digest('hex').slice(0, 16);
  return join(actoriumDir, `auth.${key}.${accountKeyFor(accountId)}.json`);
}

const PROD_URL = 'https://api.actorium.ai';
const LOCAL_URL = 'http://localhost:8090';

async function run(): Promise<void> {
  const prodPath = credentialPathFor(PROD_URL);

  // Writing creates the file with the expected shape.
  {
    await writeCredentialFile({
      accessToken: 'jwt-abc',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      bffUrl: PROD_URL,
      updatedAt: 123,
    });

    ok(existsSync(prodPath), 'credential file should exist after write');
    const parsed = JSON.parse(readFileSync(prodPath, 'utf8'));
    deepStrictEqual(parsed, {
      accessToken: 'jwt-abc',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      bffUrl: PROD_URL,
      updatedAt: 123,
    });

    // 0o600 — owner read/write only, no group/other access.
    const mode = statSync(prodPath).mode & 0o777;
    deepStrictEqual(mode, 0o600);
  }

  // Writing again overwrites the previous contents for the SAME backend
  // (e.g. workspace switch).
  {
    await writeCredentialFile({
      accessToken: 'jwt-def',
      orgId: 'org-2',
      workspaceId: 'ws-2',
      bffUrl: PROD_URL,
      updatedAt: 456,
    });

    const parsed = JSON.parse(readFileSync(prodPath, 'utf8'));
    deepStrictEqual(parsed.accessToken, 'jwt-def');
    deepStrictEqual(parsed.workspaceId, 'ws-2');
  }

  // A different backend (different bffUrl — e.g. another window on a
  // different actorium.environment) gets its OWN file and doesn't clobber
  // or get clobbered by the first backend's session.
  {
    const localPath = credentialPathFor(LOCAL_URL);
    notDeepStrictEqual(localPath, prodPath);

    await writeCredentialFile({
      accessToken: 'jwt-local',
      bffUrl: LOCAL_URL,
      updatedAt: 789,
    });

    ok(existsSync(localPath), 'local backend should have its own credential file');
    ok(existsSync(prodPath), 'writing the local backend must not remove the prod file');
    deepStrictEqual(JSON.parse(readFileSync(prodPath, 'utf8')).accessToken, 'jwt-def');
    deepStrictEqual(JSON.parse(readFileSync(localPath, 'utf8')).accessToken, 'jwt-local');

    // Deleting one backend's file (disconnect from it) leaves the other
    // backend's session untouched.
    await deleteCredentialFile(LOCAL_URL);
    ok(!existsSync(localPath), 'local credential file should be gone after delete');
    ok(existsSync(prodPath), 'deleting local backend must not remove the prod file');
  }

  // Deleting removes the file (disconnect).
  {
    await deleteCredentialFile(PROD_URL);
    ok(!existsSync(prodPath), 'credential file should be gone after delete');
  }

  // Deleting when the file doesn't exist is a silent no-op.
  {
    await deleteCredentialFile(PROD_URL);
    ok(!existsSync(prodPath));
  }

  // Concurrent writes to the SAME backend (two windows on the same
  // environment syncing at once) must never leave the file truncated/
  // partial for a reader — each write is atomic (temp file + rename), so at
  // any point in time the file is either missing, or fully one of the
  // written payloads, never malformed JSON.
  {
    const writes = Array.from({ length: 20 }, (_, i) =>
      writeCredentialFile({ accessToken: `jwt-${i}`, bffUrl: PROD_URL, updatedAt: i }),
    );
    // Sample the file mid-flight from a concurrent reader — every read must
    // parse cleanly, even while writers are actively racing.
    const reads = Array.from({ length: 20 }, async () => {
      if (!existsSync(prodPath)) return;
      const raw = readFileSync(prodPath, 'utf8');
      JSON.parse(raw); // throws on a torn/partial write
    });
    await Promise.all([...writes, ...reads]);

    ok(existsSync(prodPath), 'credential file should exist after concurrent writes');
    const parsed = JSON.parse(readFileSync(prodPath, 'utf8'));
    ok(/^jwt-\d+$/.test(parsed.accessToken), 'final file should hold one full, valid write');

    // No leftover .tmp files from the atomic-write dance.
    const leftovers = readdirSync(actoriumDir).filter((f) => f.endsWith('.tmp'));
    deepStrictEqual(leftovers, []);
  }

  // Passing accountId writes an ADDITIONAL account-scoped file alongside the
  // legacy one — the legacy file still gets the same content (so a
  // registration with no ACTORIUM_ACCOUNT_KEY env var keeps working
  // unmodified), and the account file carries the same payload plus identity.
  {
    const accountId = 'acct-1|user@example.com';
    const accountPath = accountCredentialPathFor(PROD_URL, accountId);

    await writeCredentialFile({
      accessToken: 'jwt-acct-1',
      bffUrl: PROD_URL,
      updatedAt: 999,
      accountId,
      accountEmail: 'user@example.com',
      accountDisplayName: 'User One',
    });

    ok(existsSync(accountPath), 'account-scoped credential file should exist after write');
    const accountParsed = JSON.parse(readFileSync(accountPath, 'utf8'));
    deepStrictEqual(accountParsed.accessToken, 'jwt-acct-1');
    deepStrictEqual(accountParsed.accountEmail, 'user@example.com');
    deepStrictEqual(accountParsed.accountDisplayName, 'User One');

    const legacyParsed = JSON.parse(readFileSync(prodPath, 'utf8'));
    deepStrictEqual(legacyParsed.accessToken, 'jwt-acct-1');

    // A second account on the SAME backend gets its own file, not clobbering
    // the first account's.
    const otherAccountId = 'acct-2|other@example.com';
    const otherAccountPath = accountCredentialPathFor(PROD_URL, otherAccountId);
    await writeCredentialFile({
      accessToken: 'jwt-acct-2',
      bffUrl: PROD_URL,
      updatedAt: 1000,
      accountId: otherAccountId,
    });

    ok(existsSync(accountPath), 'first account file should survive a second account writing');
    deepStrictEqual(JSON.parse(readFileSync(accountPath, 'utf8')).accessToken, 'jwt-acct-1');
    deepStrictEqual(JSON.parse(readFileSync(otherAccountPath, 'utf8')).accessToken, 'jwt-acct-2');

    // Deleting one account's file leaves the other account's and the legacy
    // file untouched.
    await deleteAccountCredentialFile(PROD_URL, accountId);
    ok(!existsSync(accountPath), 'deleted account file should be gone');
    ok(existsSync(otherAccountPath), 'other account file should survive');
    ok(existsSync(prodPath), 'legacy file should survive');

    await deleteAccountCredentialFile(PROD_URL, otherAccountId);
    await deleteCredentialFile(PROD_URL);
  }

  // Omitting accountId writes only the legacy file, exactly as before
  // (back-compat — no stray account-scoped file appears).
  {
    await writeCredentialFile({ accessToken: 'jwt-no-account', bffUrl: PROD_URL, updatedAt: 1 });
    const leftoverAccountFiles = readdirSync(actoriumDir).filter(
      (f) => f.startsWith('auth.') && f.split('.').length > 3,
    );
    deepStrictEqual(leftoverAccountFiles, []);
    await deleteCredentialFile(PROD_URL);
  }

  console.log('✅ Credential file tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    process.env.HOME = realHome;
    rmSync(tempHome, { recursive: true, force: true });
  });
