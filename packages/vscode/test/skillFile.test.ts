/**
 * Unit tests for the generated link-repo Claude Code Skill (see
 * ../src/workspace/skillFile.ts) — checks it lands at the path Claude Code
 * actually discovers project skills from, with valid frontmatter.
 */

import { deepStrictEqual, ok } from 'assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { writeLinkRepoSkill } from '../src/workspace/skillFile.js';

const tempDir = mkdtempSync(join(tmpdir(), 'actorium-skillfile-test-'));
const skillPath = join(tempDir, '.claude', 'skills', 'link-repo', 'SKILL.md');

async function run(): Promise<void> {
  await writeLinkRepoSkill(tempDir);

  ok(existsSync(skillPath), 'SKILL.md should be written to .claude/skills/link-repo/');

  const content = readFileSync(skillPath, 'utf8');
  ok(content.startsWith('---\n'), 'should start with YAML frontmatter');
  ok(content.includes('name: link-repo'));
  ok(content.includes('description:'));
  ok(content.includes('ln -s'), 'should instruct the agent to symlink, not copy');
  ok(
    content.includes('actorium:generated:start'),
    "should reference AGENTS.md's marker so the agent updates the right section",
  );

  // Regenerating overwrites cleanly rather than appending.
  await writeLinkRepoSkill(tempDir);
  const second = readFileSync(skillPath, 'utf8');
  deepStrictEqual(second, content);

  console.log('✅ link-repo skill generation tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
