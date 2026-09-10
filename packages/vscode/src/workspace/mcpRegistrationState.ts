import * as vscode from 'vscode';

import type { AgentTarget } from './mcpConnect.js';

/**
 * Remembers which account/workspace we last told each (folder, agent)
 * registration to use — needed to detect and surface drift after an account
 * or workspace switch (see extension.ts's reconcileMcpForCurrentAccount and
 * panel.ts's _loadMcpStatus).
 *
 * We track this ourselves rather than parsing it back out of Claude Code's
 * own MCP config (`claude mcp get`'s output is meant for a human, not a
 * stable machine-readable contract — see mcpConnect.ts's own policy of never
 * hand-parsing Claude Code's internal config) or Codex's/opencode's. Global
 * state, not workspace state, since a folder can be opened in more than one
 * window/profile and the registration itself is a property of the folder on
 * disk, not of any one window.
 */
interface McpRegistrationRecord {
  bffUrl: string;
  accountId?: string;
  accountLabel?: string;
  workspaceLabel?: string;
}

const STORE_KEY = 'actorium.mcpRegistrations';

type RegistrationStore = Record<string, McpRegistrationRecord>;

function recordKey(folderPath: string, target: AgentTarget): string {
  return `${folderPath}::${target}`;
}

function readStore(context: vscode.ExtensionContext): RegistrationStore {
  return context.globalState.get<RegistrationStore>(STORE_KEY) ?? {};
}

export async function recordMcpRegistration(
  context: vscode.ExtensionContext,
  folderPath: string,
  target: AgentTarget,
  info: McpRegistrationRecord,
): Promise<void> {
  const store = readStore(context);
  store[recordKey(folderPath, target)] = info;
  await context.globalState.update(STORE_KEY, store);
}

export function getMcpRegistration(
  context: vscode.ExtensionContext,
  folderPath: string,
  target: AgentTarget,
): McpRegistrationRecord | undefined {
  return readStore(context)[recordKey(folderPath, target)];
}

export async function clearMcpRegistration(
  context: vscode.ExtensionContext,
  folderPath: string,
  target: AgentTarget,
): Promise<void> {
  const store = readStore(context);
  delete store[recordKey(folderPath, target)];
  await context.globalState.update(STORE_KEY, store);
}

// ── Session-opened tracking (best-effort "needs restart" signal) ────────────

/** Records roughly when the user last opened `target`'s CLI in a terminal
 * for `folderPath` (see extension.ts's openAgentCli) — compared against a
 * later MCP-config rewrite (reconcileMcpForCurrentAccount) to flag "this
 * session predates a config change, restart it to pick that up". A
 * heuristic, not a liveness check: VS Code has no way to know whether that
 * terminal's CLI process is still running, was closed, or was restarted
 * manually since. */
const SESSION_OPENED_STORE_KEY = 'actorium.mcpAgentSessionOpenedAt';

type SessionOpenedStore = Record<string, number>;

export async function recordAgentSessionOpened(
  context: vscode.ExtensionContext,
  folderPath: string,
  target: AgentTarget,
): Promise<void> {
  const store = context.globalState.get<SessionOpenedStore>(SESSION_OPENED_STORE_KEY) ?? {};
  store[recordKey(folderPath, target)] = Date.now();
  await context.globalState.update(SESSION_OPENED_STORE_KEY, store);
}

export function getAgentSessionOpenedAt(
  context: vscode.ExtensionContext,
  folderPath: string,
  target: AgentTarget,
): number | undefined {
  const store = context.globalState.get<SessionOpenedStore>(SESSION_OPENED_STORE_KEY) ?? {};
  return store[recordKey(folderPath, target)];
}
