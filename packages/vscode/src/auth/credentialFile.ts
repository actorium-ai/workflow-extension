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
 */
function credentialFilePath(bffUrl: string): string {
  const key = createHash('sha256').update(bffUrl).digest('hex').slice(0, 16);
  return path.join(os.homedir(), '.actorium', `auth.${key}.json`);
}

export async function writeCredentialFile(creds: StoredCredentials): Promise<void> {
  const filePath = credentialFilePath(creds.bffUrl);
  const tmpPath = `${filePath}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(tmpPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  } catch {
    // best-effort — see doc comment above
    await fs.unlink(tmpPath).catch(() => {});
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
