/**
 * Unit tests for the WORKSPACE-RULES.md generator (see
 * ../src/workspace/workspaceRulesFile.ts) — create-once semantics matter
 * here: this file is meant to hold user-authored rules that must survive
 * every AGENTS.md regeneration, so an existing one must never be touched.
 */

import { deepStrictEqual, ok } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ensureWorkspaceRulesFile } from '../src/workspace/workspaceRulesFile.js';

const tempDir = mkdtempSync(join(tmpdir(), 'actorium-workspacerules-test-'));
const rulesPath = join(tempDir, 'WORKSPACE-RULES.md');

async function run(): Promise<void> {
  // First call creates the file with the starter template.
  {
    await ensureWorkspaceRulesFile(tempDir);
    const content = readFileSync(rulesPath, 'utf8');
    ok(content.includes('# Workspace custom rules'));
  }

  // Never overwrites an existing file — user's own rules survive.
  {
    writeFileSync(rulesPath, '# My custom rules\n\nDo not touch this.\n', 'utf8');
    await ensureWorkspaceRulesFile(tempDir);
    deepStrictEqual(readFileSync(rulesPath, 'utf8'), '# My custom rules\n\nDo not touch this.\n');
  }

  // WORKSPACE-RULES.md is a convenience, never a requirement — a write
  // failure (e.g. a nonexistent target folder) must resolve quietly rather
  // than throwing.
  {
    const missingDir = join(tempDir, 'does-not-exist');
    await ensureWorkspaceRulesFile(missingDir);
    ok(true, 'ensureWorkspaceRulesFile resolved without throwing');
  }

  console.log('✅ WORKSPACE-RULES.md generation tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
