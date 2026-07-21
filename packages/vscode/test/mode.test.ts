/**
 * Unit tests for the Mode Gate — Ask/Plan/Auto enforcement logic.
 */

import { deepStrictEqual, ok, rejects } from 'assert';

// ── Minimal mock of ModeGate logic ──────────────────────────────────────
//
// We test the mode enforcement logic in isolation (without VS Code APIs).

type OperationalMode = 'ask' | 'plan' | 'auto';

const MUTATION_TOOLS = new Set([
  'edit_file',
  'write_file',
  'create_directory',
  'run_command',
  'git_commit',
  'git_push',
  'git_checkout',
]);

function isMutationTool(tool: string): boolean {
  return MUTATION_TOOLS.has(tool);
}

function planModeBlocked(tool: string): boolean {
  return isMutationTool(tool);
}

function askModeNeedsApproval(tool: string): boolean {
  return isMutationTool(tool) && tool !== 'clarify';
}

// ── Tests ──────────────────────────────────────────────────────────────

// Mutation tool detection
deepStrictEqual(isMutationTool('edit_file'), true, 'edit_file is a mutation tool');
deepStrictEqual(isMutationTool('write_file'), true, 'write_file is a mutation tool');
deepStrictEqual(isMutationTool('create_directory'), true, 'create_directory is a mutation tool');
deepStrictEqual(isMutationTool('run_command'), true, 'run_command is a mutation tool');
deepStrictEqual(isMutationTool('git_commit'), true, 'git_commit is a mutation tool');
deepStrictEqual(isMutationTool('git_push'), true, 'git_push is a mutation tool');
deepStrictEqual(isMutationTool('git_checkout'), true, 'git_checkout is a mutation tool');

// Read-only tools are NOT mutation tools
deepStrictEqual(isMutationTool('read_file'), false, 'read_file is not a mutation tool');
deepStrictEqual(
  isMutationTool('browse_directory'),
  false,
  'browse_directory is not a mutation tool',
);
deepStrictEqual(isMutationTool('search_code'), false, 'search_code is not a mutation tool');
deepStrictEqual(isMutationTool('search_files'), false, 'search_files is not a mutation tool');
deepStrictEqual(isMutationTool('git_status'), false, 'git_status is not a mutation tool');
deepStrictEqual(isMutationTool('git_diff'), false, 'git_diff is not a mutation tool');
deepStrictEqual(isMutationTool('git_log'), false, 'git_log is not a mutation tool');
deepStrictEqual(isMutationTool('clarify'), false, 'clarify is not a mutation tool');

// Plan mode: all mutation tools are blocked
deepStrictEqual(planModeBlocked('edit_file'), true);
deepStrictEqual(planModeBlocked('write_file'), true);
deepStrictEqual(planModeBlocked('create_directory'), true);
deepStrictEqual(planModeBlocked('run_command'), true);
deepStrictEqual(planModeBlocked('git_commit'), true);
deepStrictEqual(planModeBlocked('git_push'), true);
deepStrictEqual(planModeBlocked('git_checkout'), true);

// Plan mode: read-only tools are NOT blocked
deepStrictEqual(planModeBlocked('read_file'), false);
deepStrictEqual(planModeBlocked('browse_directory'), false);
deepStrictEqual(planModeBlocked('search_code'), false);
deepStrictEqual(planModeBlocked('git_status'), false);
deepStrictEqual(planModeBlocked('git_log'), false);

// Ask mode: mutation tools need approval
deepStrictEqual(askModeNeedsApproval('edit_file'), true);
deepStrictEqual(askModeNeedsApproval('write_file'), true);
deepStrictEqual(askModeNeedsApproval('run_command'), true);
deepStrictEqual(askModeNeedsApproval('git_commit'), true);

// Ask mode: read-only tools do NOT need approval
deepStrictEqual(askModeNeedsApproval('read_file'), false);
deepStrictEqual(askModeNeedsApproval('browse_directory'), false);
deepStrictEqual(askModeNeedsApproval('git_status'), false);
deepStrictEqual(askModeNeedsApproval('search_files'), false);

// Clarify is never a mutation tool even if someone adds it there
deepStrictEqual(askModeNeedsApproval('clarify'), false);
deepStrictEqual(planModeBlocked('clarify'), false);

console.log('✅ Mode gate tests passed');
