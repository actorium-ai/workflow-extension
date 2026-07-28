/**
 * Unit tests for AGENTS.md generation/regeneration (see
 * ../src/workspace/agentsFile.ts) — specifically the marker-based
 * regeneration contract: only the region between the start/end HTML comment
 * markers is ever rewritten, so a user's own notes elsewhere in the file
 * survive a later "Add repo" regeneration. The generated section itself
 * points at .actorium/repo-links.json rather than listing repos inline (see
 * repoLinkManifest.ts) — that file, not AGENTS.md, is the linked-repo
 * source of truth an agent should read.
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
  // First write creates the file with the generated section. Passing null
  // for sharedRulesMarkdown exercises the "bundled shared.md missing"
  // fallback notice, since no real bundle exists in this unit-test context.
  {
    await writeAgentsFile(tempDir, baseParams, null);

    const content = readFileSync(agentsPath, 'utf8');
    ok(content.includes('<!-- actorium:generated:start -->'));
    ok(content.includes('<!-- actorium:generated:end -->'));
    ok(content.includes('.actorium/repo-links.json'));
    ok(content.includes('ws-123'));
    ok(content.includes("wasn't found in this extension build"));
  }

  // A user's hand-written note appended after the generated section...
  {
    const content = readFileSync(agentsPath, 'utf8');
    const withUserNote = `${content}\n## My own notes\n\nDon't touch this.\n`;
    writeFileSync(agentsPath, withUserNote, 'utf8');
  }

  // ...survives a regeneration in place, without duplicating the markers.
  // This pass also exercises real shared-rules content, checking it's
  // embedded verbatim (modulo the heading shift) rather than just linked to.
  {
    await writeAgentsFile(
      tempDir,
      baseParams,
      '# Shared workflow rules\n\n## Task structure rules\n',
    );

    const content = readFileSync(agentsPath, 'utf8');
    ok(content.includes("Don't touch this."), 'hand-written note should survive regeneration');
    ok(
      content.includes('## Shared workflow rules') && content.includes('### Task structure rules'),
      'shared.md headings should shift down one level when embedded',
    );
    // Exactly one of each marker — regeneration replaces in place, never
    // appends a second generated block.
    deepStrictEqual(content.split('<!-- actorium:generated:start -->').length - 1, 1);
    deepStrictEqual(content.split('<!-- actorium:generated:end -->').length - 1, 1);
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
