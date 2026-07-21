/**
 * Unit tests for the tool result payload structures.
 */

import { deepStrictEqual } from 'assert';

interface ToolResultPayload {
  ok: boolean | null;
  applied?: boolean;
  content?: string;
  error?: string;
  files?: Array<{ name: string; path: string; type: 'file' | 'directory' }>;
  path?: string;
}

// ── Tests ──────────────────────────────────────────────────────────────

// Successful file read
{
  const result: ToolResultPayload = {
    ok: true,
    content: 'export function hello() { return "world"; }',
  };
  deepStrictEqual(result.ok, true);
  deepStrictEqual(result.content?.length, 43);
  deepStrictEqual(result.error, undefined);
}

// Failed file read
{
  const result: ToolResultPayload = {
    ok: false,
    error: 'File not found: src/missing.ts',
  };
  deepStrictEqual(result.ok, false);
  deepStrictEqual(result.error, 'File not found: src/missing.ts');
}

// Successful edit
{
  const result: ToolResultPayload = {
    ok: true,
    applied: true,
  };
  deepStrictEqual(result.ok, true);
  deepStrictEqual(result.applied, true);
}

// Rejected edit
{
  const result: ToolResultPayload = {
    ok: false,
    applied: false,
    error: 'User rejected the change.',
  };
  deepStrictEqual(result.ok, false);
  deepStrictEqual(result.applied, false);
}

// Deferred tool call (ok is null — not yet executed)
{
  const result: ToolResultPayload = {
    ok: null,
    path: 'src/middleware/',
  };
  deepStrictEqual(result.ok, null);
  deepStrictEqual(result.path, 'src/middleware/');
}

// Directory browse
{
  const result: ToolResultPayload = {
    ok: true,
    files: [
      { name: 'login.ts', path: 'src/login.ts', type: 'file' },
      { name: 'middleware', path: 'src/middleware', type: 'directory' },
    ],
  };
  deepStrictEqual(result.ok, true);
  deepStrictEqual(result.files?.length, 2);
  deepStrictEqual(result.files![0]!.type, 'file');
  deepStrictEqual(result.files![1]!.type, 'directory');
}

// Command result with error
{
  const result: ToolResultPayload = {
    ok: false,
    content: 'npm ERR! missing script: build',
    error: 'Command failed with exit code 1',
  };
  deepStrictEqual(result.ok, false);
  ok(result.content!.includes('npm ERR!'));
}

function ok(condition: boolean, message?: string): void {
  deepStrictEqual(condition, true, message);
}

console.log('✅ Tool result tests passed');
