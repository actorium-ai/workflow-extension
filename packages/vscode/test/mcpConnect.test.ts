/**
 * Unit tests for the opencode.json read/merge logic in
 * ../src/workspace/mcpConnect.ts — the one connect/disconnect/status path
 * that's pure filesystem work rather than shelling out to an external CLI
 * (Claude Code/Codex have their own `mcp add`/`mcp get`/`mcp remove`
 * subcommands, not practically unit-testable here without mocking
 * child_process or having those CLIs installed).
 */

import { deepStrictEqual, ok } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  connectOpencode,
  disconnectOpencode,
  getMcpCliStatus,
  getOpencodeStatus,
} from '../src/workspace/mcpConnect.js';

const tempDir = mkdtempSync(join(tmpdir(), 'actorium-mcpconnect-test-'));
const configPath = join(tempDir, 'opencode.json');

async function run(): Promise<void> {
  // No existing opencode.json — creates one with the actorium-mcp entry.
  {
    const result = await connectOpencode(tempDir, 'http://localhost:8090');
    ok(result.ok);

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    deepStrictEqual(config.mcp['actorium-mcp'], {
      type: 'local',
      command: ['actorium-mcp'],
      environment: { API_URL: 'http://localhost:8090' },
      enabled: true,
    });
  }

  // An existing opencode.json with unrelated settings keeps them, and a
  // pre-existing different MCP server entry survives alongside ours.
  {
    writeFileSync(
      configPath,
      JSON.stringify({ theme: 'dark', mcp: { 'other-server': { type: 'local', command: ['x'] } } }),
      'utf8',
    );

    const result = await connectOpencode(tempDir, 'http://bff.example.com');
    ok(result.ok);

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    deepStrictEqual(config.theme, 'dark');
    deepStrictEqual(config.mcp['other-server'], { type: 'local', command: ['x'] });
    deepStrictEqual(config.mcp['actorium-mcp'].environment, {
      API_URL: 'http://bff.example.com',
    });
  }

  // Re-running overwrites only the actorium-mcp entry (e.g. BFF URL changed).
  {
    const result = await connectOpencode(tempDir, 'http://bff2.example.com');
    ok(result.ok);

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    deepStrictEqual(config.mcp['actorium-mcp'].environment.API_URL, 'http://bff2.example.com');
    ok(config.mcp['other-server'], 'other server entries should still be present');
  }

  // Malformed existing JSON is reported as an error, not silently clobbered.
  {
    const badDir = mkdtempSync(join(tmpdir(), 'actorium-mcpconnect-bad-'));
    try {
      writeFileSync(join(badDir, 'opencode.json'), '{ not valid json', 'utf8');
      const result = await connectOpencode(badDir, 'http://localhost:8090');
      ok(!result.ok);
      ok(result.message.includes('opencode.json'));

      const status = await getOpencodeStatus(badDir);
      ok(!status.registered, 'malformed config should report unregistered, not throw');
    } finally {
      rmSync(badDir, { recursive: true, force: true });
    }
  }

  // getOpencodeStatus reflects the current file state.
  {
    const result = await getOpencodeStatus(tempDir);
    ok(result.registered, 'should report registered after connectOpencode ran above');
    deepStrictEqual(result.connected, undefined, 'opencode has no live health check');
  }

  // No opencode.json at all — not registered, not an error.
  {
    const emptyDir = mkdtempSync(join(tmpdir(), 'actorium-mcpconnect-empty-'));
    try {
      const result = await getOpencodeStatus(emptyDir);
      deepStrictEqual(result, { registered: false });
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }

  // disconnectOpencode removes only the actorium-mcp entry.
  {
    const result = await disconnectOpencode(tempDir);
    ok(result.ok);

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    ok(!('actorium-mcp' in config.mcp), 'actorium-mcp entry should be gone');
    ok(config.mcp['other-server'], 'unrelated server entries should survive disconnect');

    const status = await getOpencodeStatus(tempDir);
    deepStrictEqual(status, { registered: false });
  }

  // disconnectOpencode is a no-op (not an error) when nothing was registered.
  {
    const result = await disconnectOpencode(tempDir);
    ok(result.ok);
    ok(result.message.includes('was not registered'));
  }

  // getMcpCliStatus shells out to the real `actorium-mcp` binary — whether
  // it's actually on this machine's PATH varies by environment, so this only
  // asserts the shape holds either way, not a specific installed value
  // (mirrors this file's own note above: not practically unit-testable
  // without mocking child_process or requiring the CLI be present).
  {
    const status = await getMcpCliStatus();
    ok(typeof status.installed === 'boolean');
    if (status.installed) {
      ok(typeof status.version === 'string' && status.version.length > 0);
    } else {
      deepStrictEqual(status.version, undefined);
    }
  }

  console.log('✅ connectOpencode/disconnectOpencode/getOpencodeStatus tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
