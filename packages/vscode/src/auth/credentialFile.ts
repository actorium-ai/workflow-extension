import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface StoredCredentials {
  accessToken: string;
  orgId?: string;
  workspaceId?: string;
  updatedAt: number;
}

function credentialFilePath(): string {
  return path.join(os.homedir(), '.actorium', 'auth.json');
}

/**
 * Mirrors AuthManager's in-memory token/org/workspace state to a shared local
 * file that `workflow-mcp` reads per-request (see that repo's src/authFile.ts
 * and AGENTS.md) — this is what lets a local coding agent's MCP tool calls
 * authenticate without any manual cookie/token setup. Best-effort: a write
 * failure (e.g. read-only home dir) just means workflow-mcp falls back to a
 * manually-configured WORKFLOW_TOKEN, not a broken extension, so failures are
 * swallowed rather than surfaced to the user.
 */
export async function writeCredentialFile(creds: StoredCredentials): Promise<void> {
  const filePath = credentialFilePath();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(filePath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  } catch {
    // best-effort — see doc comment above
  }
}

/** Removes the credential file on disconnect — a stale token left on disk
 * would otherwise let workflow-mcp keep authenticating as the signed-out
 * user. Silently no-ops if the file was never written or already gone. */
export async function deleteCredentialFile(): Promise<void> {
  try {
    await fs.unlink(credentialFilePath());
  } catch {
    // already gone / never written — fine
  }
}
