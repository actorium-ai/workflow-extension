/**
 * Unit tests for the shared credential file writer/deleter (see
 * ../src/auth/credentialFile.ts) — the file workflow-mcp reads per-request
 * so a local coding agent's MCP tool calls authenticate without any manual
 * cookie/token setup. Points HOME at a throwaway temp dir (os.homedir()
 * respects $HOME on POSIX) rather than touching the real ~/.actorium.
 */

import { deepStrictEqual, ok } from 'assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { deleteCredentialFile, writeCredentialFile } from '../src/auth/credentialFile.js';

const realHome = process.env.HOME;
const tempHome = mkdtempSync(join(tmpdir(), 'actorium-credfile-test-'));
process.env.HOME = tempHome;

const credentialPath = join(tempHome, '.actorium', 'auth.json');

async function run(): Promise<void> {
  // Writing creates the file with the expected shape.
  {
    await writeCredentialFile({
      accessToken: 'jwt-abc',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      updatedAt: 123,
    });

    ok(existsSync(credentialPath), 'credential file should exist after write');
    const parsed = JSON.parse(readFileSync(credentialPath, 'utf8'));
    deepStrictEqual(parsed, {
      accessToken: 'jwt-abc',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      updatedAt: 123,
    });

    // 0o600 — owner read/write only, no group/other access.
    const mode = statSync(credentialPath).mode & 0o777;
    deepStrictEqual(mode, 0o600);
  }

  // Writing again overwrites the previous contents (e.g. workspace switch).
  {
    await writeCredentialFile({
      accessToken: 'jwt-def',
      orgId: 'org-2',
      workspaceId: 'ws-2',
      updatedAt: 456,
    });

    const parsed = JSON.parse(readFileSync(credentialPath, 'utf8'));
    deepStrictEqual(parsed.accessToken, 'jwt-def');
    deepStrictEqual(parsed.workspaceId, 'ws-2');
  }

  // Deleting removes the file (disconnect).
  {
    await deleteCredentialFile();
    ok(!existsSync(credentialPath), 'credential file should be gone after delete');
  }

  // Deleting when the file doesn't exist is a silent no-op.
  {
    await deleteCredentialFile();
    ok(!existsSync(credentialPath));
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
