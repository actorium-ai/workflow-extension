import { Loader2 } from 'lucide-react';

import type { AgentStatuses, AgentTarget } from '../utils/types.ts';
import { CliIcon } from './cli-icon.tsx';

const AGENT_LABELS: Record<AgentTarget, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
};

const AGENTS: AgentTarget[] = ['claude', 'codex', 'opencode'];

/** Small presence dot on the icon's corner, mirroring chat-app avatar status
 * indicators — carries the same state the old text label did, without
 * spending row width on words. Green: verified connected (Claude Code's real
 * health check). Amber: registered but either unverified (Codex/opencode
 * have no live check) or verified-failed. Gray: not registered at all. A
 * stale/needsRestart registration additionally gets an amber ring around the
 * icon (layered on top of, not replacing, this dot) — see StaleRing below —
 * since that's a separate signal from live connectivity: a registration can
 * be perfectly "connected" and still be pointed at the wrong account. */
function StatusDot({ registered, connected }: { registered: boolean; connected?: boolean }) {
  const color = !registered
    ? 'bg-text-muted'
    : connected === false
      ? 'bg-danger'
      : connected === true
        ? 'bg-success'
        : 'bg-warning';
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-bg ${color}`}
      aria-hidden="true"
    />
  );
}

/** Amber ring around the CLI icon when this registration is stale (bound to
 * a different account/workspace than the one currently active) or needs a
 * restart to pick up a config rewrite — see agentTitle below for the
 * tooltip that explains which. */
function StaleRing({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      className="pointer-events-none absolute -inset-0.5 rounded-full ring-2 ring-warning"
      aria-hidden="true"
    />
  );
}

function statusLabel(registered: boolean, connected?: boolean): string {
  if (!registered) return 'Not connected';
  if (connected === true) return 'Connected';
  if (connected === false) return 'Registered — failed to connect';
  return 'Registered';
}

function agentTitle(
  target: AgentTarget,
  status: AgentStatuses[AgentTarget],
  activeAccountLabel: string | null,
): string {
  if (status?.stale) {
    const boundTo = status.boundAccountLabel ?? 'a different account';
    const workspace = status.boundWorkspaceLabel ? ` on "${status.boundWorkspaceLabel}"` : '';
    const active = activeAccountLabel ? ` — now signed in as ${activeAccountLabel}` : '';
    return `Registered for ${boundTo}${workspace}${active}. Click Reconnect to update.`;
  }
  if (status?.needsRestart) {
    return `Config updated for the new account — restart ${AGENT_LABELS[target]} to use it.`;
  }
  return status?.detail ?? statusLabel(status?.registered ?? false, status?.connected);
}

interface AgentStatusListProps {
  statuses: AgentStatuses;
  pendingAgents: Set<AgentTarget>;
  onConnect: (target: AgentTarget) => void;
  onDisconnect: (target: AgentTarget) => void;
  /** Opens a terminal in the workspace folder and starts this agent's CLI —
   * see the extension host's src/extension.ts openAgentCli. */
  onOpenCli: (target: AgentTarget) => void;
  /** Whether the actorium-mcp binary itself is on PATH (see
   * McpCliStatusRow above it) — connecting registers actorium-mcp as an MCP
   * server command, so it's meaningless (and errors out) before the binary
   * exists. Disconnecting a stale registration never needs the binary, so
   * that action stays available regardless. */
  mcpCliInstalled: boolean;
  /** The currently active account's display name/email — named in a stale
   * row's tooltip so "reconnect" reads as "point this at YOU" rather than a
   * generic warning. Null when signed out. */
  activeAccountLabel: string | null;
}

/** Shows whether actorium-mcp is registered with each local coding agent —
 * and, for Claude Code, whether it's actually reachable right now (its own
 * `mcp get` does a real health check; Codex/opencode can only confirm the
 * config entry exists). Each row's action flips between Connect/Disconnect
 * based on current registration state; clicking the row itself (icon/label)
 * opens the agent's CLI in a terminal instead. */
export function AgentStatusList({
  statuses,
  pendingAgents,
  onConnect,
  onDisconnect,
  onOpenCli,
  mcpCliInstalled,
  activeAccountLabel,
}: AgentStatusListProps) {
  return (
    <>
      {AGENTS.map((target) => {
        const status = statuses[target];
        const registered = status?.registered ?? false;
        const pending = pendingAgents.has(target);
        const connectBlocked = !registered && !mcpCliInstalled;
        // A stale registration still shows "Disconnect" as an option (it
        // works fine — Disconnect never needs the binary or a live account),
        // but the primary action becomes Reconnect so fixing the drift is
        // one click, not disconnect-then-reconnect.
        const needsReconnect = registered && !!status?.stale;
        return (
          <div key={target} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5">
            <button
              type="button"
              title={`Open ${AGENT_LABELS[target]} in a terminal`}
              onClick={() => onOpenCli(target)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="relative shrink-0">
                <StaleRing show={registered && (!!status?.stale || !!status?.needsRestart)} />
                <CliIcon name={target} />
                <StatusDot registered={registered} connected={status?.connected} />
              </span>
              <span
                title={agentTitle(target, status, activeAccountLabel)}
                className="min-w-0 flex-1 truncate text-xs text-text-secondary"
              >
                {AGENT_LABELS[target]}
              </span>
            </button>
            {connectBlocked ? (
              <span
                title="Install actorium-mcp above first"
                className="shrink-0 px-2 py-0.5 text-[11px] font-medium text-text-muted"
              >
                Connect
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                title={needsReconnect ? agentTitle(target, status, activeAccountLabel) : undefined}
                onClick={() =>
                  needsReconnect
                    ? onConnect(target)
                    : registered
                      ? onDisconnect(target)
                      : onConnect(target)
                }
                className={
                  'flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium disabled:pointer-events-none disabled:opacity-60' +
                  (needsReconnect
                    ? ' text-warning hover:bg-warning/10'
                    : registered
                      ? ' text-text-muted hover:bg-danger/10 hover:text-danger'
                      : ' text-accent-foreground hover:bg-primary/10')
                }
              >
                {pending && (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
                )}
                {pending
                  ? needsReconnect || !registered
                    ? 'Connecting…'
                    : 'Disconnecting…'
                  : needsReconnect
                    ? 'Reconnect'
                    : registered
                      ? 'Disconnect'
                      : 'Connect'}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
