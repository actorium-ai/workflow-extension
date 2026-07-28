/**
 * Unit tests for the .env / .gitignore generators (see ../src/workspace/envFile.ts)
 * — create-once semantics matter here: a workspace .env may already hold real
 * tokens, so regeneration must never touch an existing file.
 */

import { deepStrictEqual, ok } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ensureEnvFile, ensureEnvGitignored } from '../src/workspace/envFile.js';

const tempDir = mkdtempSync(join(tmpdir(), 'actorium-envfile-test-'));
const envPath = join(tempDir, '.env');
const gitignorePath = join(tempDir, '.gitignore');

async function run(): Promise<void> {
  // First call creates a blank .env with both known token keys.
  {
    await ensureEnvFile(tempDir);
    const content = readFileSync(envPath, 'utf8');
    ok(content.includes('FIGMA_PERSONAL_ACCESS_TOKEN='));
    ok(content.includes('GITHUB_TOKEN='));
  }

  // Never overwrites an existing .env — real tokens survive.
  {
    writeFileSync(envPath, 'GITHUB_TOKEN=real-secret\n', 'utf8');
    await ensureEnvFile(tempDir);
    deepStrictEqual(readFileSync(envPath, 'utf8'), 'GITHUB_TOKEN=real-secret\n');
  }

  // Creates .gitignore with a .env entry when missing.
  {
    await ensureEnvGitignored(tempDir);
    const content = readFileSync(gitignorePath, 'utf8');
    ok(content.split('\n').some((line) => line.trim() === '.env'));
  }

  // Appends .env to an existing .gitignore that doesn't already ignore it.
  {
    writeFileSync(gitignorePath, 'node_modules\n', 'utf8');
    await ensureEnvGitignored(tempDir);
    const content = readFileSync(gitignorePath, 'utf8');
    ok(content.includes('node_modules'));
    ok(content.split('\n').some((line) => line.trim() === '.env'));
  }

  // Never duplicates the entry if .env is already ignored.
  {
    writeFileSync(gitignorePath, 'node_modules\n.env\n', 'utf8');
    await ensureEnvGitignored(tempDir);
    const content = readFileSync(gitignorePath, 'utf8');
    deepStrictEqual(content.split('\n').filter((line) => line.trim() === '.env').length, 1);
  }

  // `.env` is a convenience, never a requirement — a write failure (e.g. a
  // nonexistent target folder) must resolve quietly rather than throwing,
  // so it can never block the more important steps in regenerateAgentsFile.
  {
    const missingDir = join(tempDir, 'does-not-exist');
    await ensureEnvFile(missingDir);
    await ensureEnvGitignored(missingDir);
    ok(true, 'ensureEnvFile/ensureEnvGitignored resolved without throwing');
  }

  console.log('✅ .env / .gitignore generation tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
