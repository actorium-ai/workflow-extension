/**
 * Unit tests for AGENTS.md generation/regeneration (see
 * ../src/workspace/agentsFile.ts) — specifically the marker-based
 * regeneration contract: only the region between the start/end HTML comment
 * markers is ever rewritten, so a user's own notes elsewhere in the file
 * survive a later "Add repo" regeneration.
 */

import { deepStrictEqual, ok } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { writeAgentsFile } from '../src/workspace/agentsFile.js';

const tempDir = mkdtempSync(join(tmpdir(), 'actorium-agentsfile-test-'));
const agentsPath = join(tempDir, 'AGENTS.md');

const baseParams = {
  orgName: 'Acme',
  workspaceName: 'core-platform',
  workspaceId: 'ws-123',
};

async function run(): Promise<void> {
  // First write creates the file with the generated section, listing repos.
  {
    await writeAgentsFile(tempDir, {
      ...baseParams,
      linkedRepos: [{ name: 'workflow-backend', target: '/home/user/code/workflow-backend' }],
    });

    const content = readFileSync(agentsPath, 'utf8');
    ok(content.includes('<!-- actorium:generated:start -->'));
    ok(content.includes('<!-- actorium:generated:end -->'));
    ok(content.includes('workflow-backend'));
    ok(content.includes('ws-123'));
  }

  // A user's hand-written note appended after the generated section...
  {
    const content = readFileSync(agentsPath, 'utf8');
    const withUserNote = `${content}\n## My own notes\n\nDon't touch this.\n`;
    writeFileSync(agentsPath, withUserNote, 'utf8');
  }

  // ...survives a regeneration with an updated repo list.
  {
    await writeAgentsFile(tempDir, {
      ...baseParams,
      linkedRepos: [
        { name: 'workflow-backend', target: '/home/user/code/workflow-backend' },
        { name: 'workflow-mcp', target: '/home/user/code/workflow-mcp' },
      ],
    });

    const content = readFileSync(agentsPath, 'utf8');
    ok(content.includes('workflow-mcp'), 'regenerated section should include the new repo');
    ok(content.includes("Don't touch this."), 'hand-written note should survive regeneration');
    // Exactly one of each marker — regeneration replaces in place, never
    // appends a second generated block.
    deepStrictEqual(content.split('<!-- actorium:generated:start -->').length - 1, 1);
    deepStrictEqual(content.split('<!-- actorium:generated:end -->').length - 1, 1);
  }

  // No repos linked yet renders a helpful placeholder instead of an empty list.
  {
    const emptyDir = mkdtempSync(join(tmpdir(), 'actorium-agentsfile-empty-'));
    try {
      await writeAgentsFile(emptyDir, { ...baseParams, linkedRepos: [] });
      const content = readFileSync(join(emptyDir, 'AGENTS.md'), 'utf8');
      ok(content.includes('No repos linked yet'));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }

  console.log('✅ AGENTS.md generation tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
