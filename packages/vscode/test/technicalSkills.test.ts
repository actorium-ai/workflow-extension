/**
 * Unit tests for ../src/workspace/technicalSkills.ts — skills are now
 * synced from workflow-backend's skills registry (GET
 * .../skill-policies/candidates + GET .../skills/versions/:id/files)
 * instead of read from a bundled resources/technical_skills directory.
 * Mocks global fetch rather than hitting a real backend.
 */

import { deepStrictEqual, ok } from 'assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { CodingApiConfig } from '../src/navigator/workflow-api.js';
import {
  getTechnicalSkillsStatus,
  installTechnicalSkills,
  uninstallTechnicalSkills,
} from '../src/workspace/technicalSkills.js';

const tempDir = mkdtempSync(join(tmpdir(), 'actorium-technicalskills-test-'));
const workspaceId = 'ws-1';

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Installs a fresh fetch mock (each call replaces the previous one — tests
 * run sequentially in this one file/process, never concurrently) and
 * returns a CodingApiConfig pointed at it. */
function makeConfig(handlers: Record<string, unknown>): CodingApiConfig {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const key = Object.keys(handlers).find((k) => String(url).includes(k));
    if (!key) return new Response('not found', { status: 404 });
    return jsonResponse(200, handlers[key]);
  }) as typeof fetch;
  return {
    getToken: async () => 'test-token',
    workflowBackendUrl: 'https://backend.internal',
    storageServiceUrl: 'https://storage.internal',
    onUnauthorized: () => {},
  };
}

const candidatesFixture = {
  candidates: [
    {
      skill: { slug: 'python-best-practices', active: true, latest_version_id: 'v-py' },
      latest_version: { id: 'v-py', manifest: {} },
      enabled: true,
    },
    {
      skill: { slug: 'disabled-skill', active: true, latest_version_id: 'v-off' },
      latest_version: { id: 'v-off', manifest: {} },
      enabled: false,
    },
    {
      skill: { slug: 'codex-only-skill', active: true, latest_version_id: 'v-codex' },
      latest_version: { id: 'v-codex', manifest: { executors: ['codex'] } },
      enabled: true,
    },
  ],
};

const filesFixture: Record<string, Record<string, string>> = {
  'v-py': { 'SKILL.md': '# python-best-practices', 'references/pep8.md': 'style guide' },
  'v-codex': { 'SKILL.md': '# codex-only-skill' },
};

async function run(): Promise<void> {
  // installTechnicalSkills for 'claude': syncs the executor-compatible,
  // enabled skill (python-best-practices, executors: [] means "all"),
  // skips the disabled one, and skips codex-only-skill (executors: [codex]
  // excludes claude).
  {
    const config = makeConfig({
      '/skill-policies/candidates': candidatesFixture,
      '/versions/v-py/files': { files: filesFixture['v-py'] },
    });
    const result = await installTechnicalSkills(config, workspaceId, tempDir, 'claude');
    ok(result.ok, result.message);
    ok(existsSync(join(tempDir, '.claude', 'skills', 'python-best-practices', 'SKILL.md')));
    deepStrictEqual(
      readFileSync(
        join(tempDir, '.claude', 'skills', 'python-best-practices', 'references', 'pep8.md'),
        'utf8',
      ),
      'style guide',
    );
    ok(!existsSync(join(tempDir, '.claude', 'skills', 'disabled-skill')));
    ok(!existsSync(join(tempDir, '.claude', 'skills', 'codex-only-skill')));
  }

  // Same candidates for 'codex': codex-only-skill is now compatible and
  // syncs; python-best-practices (executors: []) still syncs too.
  {
    const config = makeConfig({
      '/skill-policies/candidates': candidatesFixture,
      '/versions/v-py/files': { files: filesFixture['v-py'] },
      '/versions/v-codex/files': { files: filesFixture['v-codex'] },
    });
    const result = await installTechnicalSkills(config, workspaceId, tempDir, 'codex');
    ok(result.ok, result.message);
    ok(existsSync(join(tempDir, '.codex', 'skills', 'python-best-practices', 'SKILL.md')));
    ok(existsSync(join(tempDir, '.codex', 'skills', 'codex-only-skill', 'SKILL.md')));
  }

  // getTechnicalSkillsStatus reports installed:true once every resolved
  // skill for 'claude' is present, total matching the resolved count (1,
  // not 3 — disabled/incompatible skills don't count toward total).
  {
    const config = makeConfig({
      '/skill-policies/candidates': candidatesFixture,
    });
    const status = await getTechnicalSkillsStatus(config, workspaceId, tempDir, 'claude');
    deepStrictEqual(status, { installed: true, total: 1 });
  }

  // uninstallTechnicalSkills for 'claude' removes the synced skill folder
  // (reads the directory itself, no network call needed) and reports it
  // uninstalled afterward.
  {
    const result = await uninstallTechnicalSkills(tempDir, 'claude');
    ok(result.ok, result.message);
    ok(!existsSync(join(tempDir, '.claude', 'skills', 'python-best-practices')));

    const config = makeConfig({ '/skill-policies/candidates': candidatesFixture });
    const status = await getTechnicalSkillsStatus(config, workspaceId, tempDir, 'claude');
    deepStrictEqual(status, { installed: false, total: 1 });
  }

  // installTechnicalSkills reports failure (not a thrown error) when the
  // registry can't be reached at all (no token / network failure / 404).
  {
    const config: CodingApiConfig = {
      getToken: async () => null,
      workflowBackendUrl: 'https://backend.internal',
      storageServiceUrl: 'https://storage.internal',
      onUnauthorized: () => {},
    };
    const result = await installTechnicalSkills(config, workspaceId, tempDir, 'opencode');
    ok(!result.ok);
  }

  console.log('✅ technicalSkills registry-sync tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
