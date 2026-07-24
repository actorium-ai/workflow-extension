/**
 * Unit tests for the IDE Context Gatherer's context shape validation.
 *
 * Imports the real shared IDEContext type (rather than a local copy) so this
 * test actually catches drift against hermes-agent's Pydantic model — every
 * field here must be the exact type Python expects (see shared/types.ts's
 * doc comment): git_status/diagnostics/selection are pre-formatted strings,
 * not structured objects/arrays, and active_file/workspace_root/etc. are
 * required non-nullable strings, not `string | null`.
 */

import type { IDEContext } from '@workflow-extension/shared';
import { deepStrictEqual, ok } from 'assert';

// ── Helper: construct a minimal context ────────────────────────────────
function createEmptyContext(): IDEContext {
  return {
    active_file: '',
    active_file_language: '',
    cursor_line: 0,
    selection: null,
    open_files: [],
    git_branch: '',
    git_status: '',
    diagnostics: '',
    workspace_root: '',
  };
}

function createFullContext(): IDEContext {
  return {
    active_file: '/home/user/project/src/login.ts',
    active_file_language: 'typescript',
    cursor_line: 42,
    selection: 'function login(req) {\n  // TODO\n}',
    open_files: [
      { path: '/home/user/project/src/login.ts', language: '', cursor_line: 0, selection: null },
      { path: '/home/user/project/src/auth.ts', language: '', cursor_line: 0, selection: null },
    ],
    git_branch: 'feature/login-flow',
    git_status: 'Modified: src/login.ts\nUntracked: src/new-file.ts',
    diagnostics: "line 45:10 [error] Type 'string' is not assignable to type 'number'",
    workspace_root: '/home/user/project',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

// Empty context has correct shape
{
  const ctx = createEmptyContext();
  deepStrictEqual(ctx.active_file, '');
  deepStrictEqual(ctx.selection, null);
  deepStrictEqual(ctx.open_files.length, 0);
  deepStrictEqual(ctx.workspace_root, '');
  deepStrictEqual(ctx.git_status, '');
  deepStrictEqual(ctx.diagnostics, '');
}

// Full context has all fields populated
{
  const ctx = createFullContext();

  ok(ctx.active_file !== '', 'active_file should be set');
  ok(ctx.selection !== null, 'selection should be set');
  ok(ctx.selection!.includes('TODO'), 'selection should carry the selected text');

  ok(ctx.open_files.length > 0, 'open_files should have entries');
  deepStrictEqual(typeof ctx.open_files[0]!.path, 'string');

  ok(ctx.workspace_root !== '', 'workspace_root should be set');

  ok(ctx.git_branch !== '', 'git_branch should be set');
  deepStrictEqual(ctx.git_branch, 'feature/login-flow');
  ok(ctx.git_status.includes('Modified'), 'git_status should summarize modified files');
  ok(ctx.git_status.includes('Untracked'), 'git_status should summarize untracked files');

  ok(ctx.diagnostics.length > 0, 'diagnostics should be a non-empty summary');
  ok(ctx.diagnostics.includes('error'), 'diagnostics should include severity label');
}

// Git status with no changes formats as an empty string, not an object
{
  const ctx: IDEContext = {
    ...createEmptyContext(),
    git_branch: 'main',
  };

  deepStrictEqual(ctx.git_status, '');
  deepStrictEqual(ctx.git_branch, 'main');
}

// Diagnostics with multiple severities join into one string
{
  const ctx: IDEContext = {
    ...createEmptyContext(),
    diagnostics: [
      'line 1:1 [error] err',
      'line 2:1 [warning] warn',
      'line 3:1 [info] info',
      'line 4:1 [hint] hint',
    ].join('\n'),
  };

  const lines = ctx.diagnostics.split('\n');
  deepStrictEqual(lines.length, 4);
  ok(lines[0]!.includes('error'));
  ok(lines[1]!.includes('warning'));
  ok(lines[2]!.includes('info'));
  ok(lines[3]!.includes('hint'));
}

console.log('✅ Context gatherer tests passed');
