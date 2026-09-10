import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface StoredCredentials {
  accessToken: string;
  orgId?: string;
  workspaceId?: string;
  bffUrl: string;
  updatedAt: number;
  /** Identifies which account this token belongs to — written whenever
   * available so both the account-scoped file (see accountCredentialFilePath)
   * and, for display/back-compat, the legacy file carry it. Lets
   * workflow-mcp's BffClient name the account in a 401 error message even
   * when reading the legacy file. */
  accountId?: string;
  accountEmail?: string;
  accountDisplayName?: string;
}

/**
 * One file per backend (`bffUrl`), not one shared flat file — each VS Code
 * window can point at a different `actorium.environment`/`bffUrl` (window
 * scope), and each backend issues its own JWT, so a single shared file can
 * only ever hold one backend's token at a time and gets overwritten by
 * whichever window/environment last synced. Filename is a deterministic hash
 * of `bffUrl` rather than the raw URL so workflow-mcp can compute the same
 * path from its own `API_URL` env var with zero coordination beyond the hash
 * function itself (sha256 of the exact bffUrl string, first 16 hex chars).
 *
 * Kept exactly as-is (same path, same "last-active-account-for-this-bffUrl"
 * semantics) for back-compat with any MCP registration made before
 * accountCredentialFilePath existed — see writeCredentialFile.
 */
function credentialFilePath(bffUrl: string): string {
  const key = createHash('sha256').update(bffUrl).digest('hex').slice(0, 16);
  return path.join(os.homedir(), '.actorium', `auth.${key}.json`);
}

/**
 * Opaque, stable key derived from an account id — never the raw id itself,
 * which can contain characters (e.g. `|`, an email-derived user id) that are
 * awkward or unsafe to pass through a CLI `--env` argument or embed in
 * another program's config file (opencode.json, Claude Code's mcp config).
 * Reused by mcpConnect.ts to bake into ACTORIUM_ACCOUNT_KEY, and independently
 * by workflow-mcp's authFile.ts to resolve the same filename — both sides
 * only ever handle this hash, never the raw accountId.
 */
export function accountKeyFor(accountId: string): string {
  return createHash('sha256').update(accountId).digest('hex').slice(0, 16);
}

/** Per-account credential file, additive alongside the legacy bffUrl-only
 * file — see writeCredentialFile. Lets two accounts signed in against the
 * same backend (two windows, or one window switching between them) each keep
 * their own token instead of clobbering the single legacy file. */
function accountCredentialFilePath(bffUrl: string, accountId: string): string {
  const bffKey = createHash('sha256').update(bffUrl).digest('hex').slice(0, 16);
  return path.join(os.homedir(), '.actorium', `auth.${bffKey}.${accountKeyFor(accountId)}.json`);
}

async function writeCredentialFileAt(filePath: string, creds: StoredCredentials): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(tmpPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  } catch {
    // best-effort — see credentialFilePath's doc comment
    await fs.unlink(tmpPath).catch(() => {});
  }
}

/** Writes the legacy bffUrl-only file (always) and, when `creds.accountId`
 * is present, also writes the account-scoped file alongside it — an existing
 * MCP registration with no ACTORIUM_ACCOUNT_KEY env var keeps reading the
 * legacy file unmodified; one registered after this account-scoping existed
 * reads its own file and stops fighting other accounts on the same backend
 * for it. */
export async function writeCredentialFile(creds: StoredCredentials): Promise<void> {
  await writeCredentialFileAt(credentialFilePath(creds.bffUrl), creds);
  if (creds.accountId) {
    await writeCredentialFileAt(accountCredentialFilePath(creds.bffUrl, creds.accountId), creds);
  }
}

/** Removes the credential file for one backend on disconnect — a stale token
 * left on disk would otherwise let workflow-mcp keep authenticating as the
 * signed-out user against that backend. Silently no-ops if the file was
 * never written or already gone. Only touches `bffUrl`'s own file, so
 * disconnecting one environment/window never affects another's stored
 * token. */
export async function deleteCredentialFile(bffUrl: string): Promise<void> {
  try {
    await fs.unlink(credentialFilePath(bffUrl));
  } catch {
    // already gone / never written — fine
  }
}

/** Removes one account's own credential file — called whenever that account
 * is signed out, regardless of whether a sibling account on the same
 * backend survives (unlike deleteCredentialFile, which only removes the
 * legacy file once NO account remains for that bffUrl): the per-account file
 * is meaningless the instant that specific account is gone. */
export async function deleteAccountCredentialFile(
  bffUrl: string,
  accountId: string,
): Promise<void> {
  try {
    await fs.unlink(accountCredentialFilePath(bffUrl, accountId));
  } catch {
    // already gone / never written — fine
  }
}
