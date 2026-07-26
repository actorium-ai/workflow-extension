/**
 * Unit tests for the .actorium/workspace.json manifest writer (see
 * ../src/workspace/workspaceManifest.ts) — actorium-mcp reads this file
 * (walking upward from its own cwd) to resolve which workspace it's running
 * for directly, so the shape/path written here must exactly match what its
 * own src/workspaceManifest.ts expects.
 */

import { deepStrictEqual, ok } from 'assert';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { writeWorkspaceManifest } from '../src/workspace/workspaceManifest.js';

const tempDir = mkdtempSync(join(tmpdir(), 'actorium-workspacemanifest-test-'));
const manifestPath = join(tempDir, '.actorium', 'workspace.json');

async function run(): Promise<void> {
  // Writes the manifest at <folder>/.actorium/workspace.json with the exact
  // shape actorium-mcp's findWorkspaceManifest expects.
  {
    await writeWorkspaceManifest(tempDir, { workspaceId: 'ws-123', orgId: 'org-456' });

    const content = JSON.parse(readFileSync(manifestPath, 'utf8'));
    deepStrictEqual(content, { workspaceId: 'ws-123', orgId: 'org-456' });
  }

  // Re-running overwrites with the new values (e.g. workspace switched).
  {
    await writeWorkspaceManifest(tempDir, { workspaceId: 'ws-789', orgId: 'org-456' });

    const content = JSON.parse(readFileSync(manifestPath, 'utf8'));
    deepStrictEqual(content, { workspaceId: 'ws-789', orgId: 'org-456' });
  }

  // Creates the .actorium directory itself when it doesn't exist yet.
  {
    const freshDir = mkdtempSync(join(tmpdir(), 'actorium-workspacemanifest-fresh-'));
    try {
      await writeWorkspaceManifest(freshDir, { workspaceId: 'ws-1', orgId: 'org-1' });
      ok(JSON.parse(readFileSync(join(freshDir, '.actorium', 'workspace.json'), 'utf8')));
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  }

  console.log('✅ workspace manifest generation tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
