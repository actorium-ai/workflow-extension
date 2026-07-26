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
 * have no live check) or verified-failed. Gray: not registered at all. */
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

function statusLabel(registered: boolean, connected?: boolean): string {
  if (!registered) return 'Not connected';
  if (connected === true) return 'Connected';
  if (connected === false) return 'Registered — failed to connect';
  return 'Registered';
}

interface AgentStatusListProps {
  statuses: AgentStatuses;
  pendingAgents: Set<AgentTarget>;
  onConnect: (target: AgentTarget) => void;
  onDisconnect: (target: AgentTarget) => void;
}

/** Shows whether actorium-mcp is registered with each local coding agent —
 * and, for Claude Code, whether it's actually reachable right now (its own
 * `mcp get` does a real health check; Codex/opencode can only confirm the
 * config entry exists). Each row's action flips between Connect/Disconnect
 * based on current registration state. */
export function AgentStatusList({
  statuses,
  pendingAgents,
  onConnect,
  onDisconnect,
}: AgentStatusListProps) {
  return (
    <>
      {AGENTS.map((target) => {
        const status = statuses[target];
        const registered = status?.registered ?? false;
        const pending = pendingAgents.has(target);
        return (
          <div
            key={target}
            title={status?.detail ?? statusLabel(registered, status?.connected)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5"
          >
            <span className="relative shrink-0">
              <CliIcon name={target} />
              <StatusDot registered={registered} connected={status?.connected} />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              {AGENT_LABELS[target]}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => (registered ? onDisconnect(target) : onConnect(target))}
              className={
                'flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium disabled:pointer-events-none disabled:opacity-60' +
                (registered
                  ? ' text-text-muted hover:bg-danger/10 hover:text-danger'
                  : ' text-accent-foreground hover:bg-primary/10')
              }
            >
              {pending && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />}
              {pending
                ? registered
                  ? 'Disconnecting…'
                  : 'Connecting…'
                : registered
                  ? 'Disconnect'
                  : 'Connect'}
            </button>
          </div>
        );
      })}
    </>
  );
}
