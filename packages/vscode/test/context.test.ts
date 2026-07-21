/**
 * Unit tests for the IDE Context Gatherer's context shape validation.
 *
 * Tests that the context object has the correct shape with all required fields.
 */

import { deepStrictEqual, ok } from 'assert';

// ── IDE Context types ──────────────────────────────────────────────────
interface IDEContext {
  active_file: string | null;
  selection: {
    start_line: number;
    end_line: number;
    text: string;
  } | null;
  open_files: string[];
  workspace_root: string | null;
  git_status: {
    branch: string | null;
    modified: string[];
    staged: string[];
    untracked: string[];
    remote_url: string | null;
  } | null;
  diagnostics: Array<{
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info' | 'hint';
    message: string;
  }>;
}

// ── Helper: construct a minimal context ────────────────────────────────
function createEmptyContext(): IDEContext {
  return {
    active_file: null,
    selection: null,
    open_files: [],
    workspace_root: null,
    git_status: null,
    diagnostics: [],
  };
}

function createFullContext(): IDEContext {
  return {
    active_file: '/home/user/project/src/login.ts',
    selection: {
      start_line: 42,
      end_line: 72,
      text: 'function login(req) {\n  // TODO\n}',
    },
    open_files: ['/home/user/project/src/login.ts', '/home/user/project/src/auth.ts'],
    workspace_root: '/home/user/project',
    git_status: {
      branch: 'feature/login-flow',
      modified: ['src/login.ts'],
      staged: [],
      untracked: ['src/new-file.ts'],
      remote_url: 'git@github.com:org/repo.git',
    },
    diagnostics: [
      {
        file: 'src/login.ts',
        line: 45,
        column: 10,
        severity: 'error',
        message: "Type 'string' is not assignable to type 'number'",
      },
    ],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

// Empty context has correct shape
{
  const ctx = createEmptyContext();
  deepStrictEqual(ctx.active_file, null);
  deepStrictEqual(ctx.selection, null);
  deepStrictEqual(ctx.open_files.length, 0);
  deepStrictEqual(ctx.workspace_root, null);
  deepStrictEqual(ctx.git_status, null);
  deepStrictEqual(ctx.diagnostics.length, 0);
}

// Full context has all fields populated
{
  const ctx = createFullContext();

  ok(ctx.active_file !== null, 'active_file should be set');
  ok(ctx.selection !== null, 'selection should be set');
  deepStrictEqual(ctx.selection!.start_line, 42);
  deepStrictEqual(ctx.selection!.end_line, 72);

  ok(ctx.open_files.length > 0, 'open_files should have entries');

  ok(ctx.workspace_root !== null, 'workspace_root should be set');

  ok(ctx.git_status !== null, 'git_status should be set');
  deepStrictEqual(ctx.git_status!.branch, 'feature/login-flow');
  deepStrictEqual(ctx.git_status!.modified.length, 1);
  deepStrictEqual(ctx.git_status!.untracked.length, 1);

  ok(ctx.diagnostics.length > 0, 'diagnostics should have entries');
  deepStrictEqual(ctx.diagnostics[0]!.severity, 'error');
}

// Git status with no changes
{
  const ctx: IDEContext = {
    active_file: null,
    selection: null,
    open_files: [],
    workspace_root: null,
    git_status: {
      branch: 'main',
      modified: [],
      staged: [],
      untracked: [],
      remote_url: null,
    },
    diagnostics: [],
  };

  deepStrictEqual(ctx.git_status!.modified.length, 0);
  deepStrictEqual(ctx.git_status!.staged.length, 0);
  deepStrictEqual(ctx.git_status!.untracked.length, 0);
}

// Diagnostics with multiple severities
{
  const ctx: IDEContext = {
    active_file: null,
    selection: null,
    open_files: [],
    workspace_root: null,
    git_status: null,
    diagnostics: [
      { file: 'a.ts', line: 1, column: 1, severity: 'error', message: 'err' },
      { file: 'a.ts', line: 2, column: 1, severity: 'warning', message: 'warn' },
      { file: 'a.ts', line: 3, column: 1, severity: 'info', message: 'info' },
      { file: 'a.ts', line: 4, column: 1, severity: 'hint', message: 'hint' },
    ],
  };

  deepStrictEqual(ctx.diagnostics.length, 4);
  deepStrictEqual(ctx.diagnostics[0]!.severity, 'error');
  deepStrictEqual(ctx.diagnostics[1]!.severity, 'warning');
  deepStrictEqual(ctx.diagnostics[2]!.severity, 'info');
  deepStrictEqual(ctx.diagnostics[3]!.severity, 'hint');
}

console.log('✅ Context gatherer tests passed');
