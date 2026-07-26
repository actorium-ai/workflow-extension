import { Loader2 } from 'lucide-react';

import type { McpCliStatus } from '../utils/types.ts';
import { CliIcon } from './cli-icon.tsx';

function versionSuffix(status: McpCliStatus | null): string {
  if (!status || !status.installed) return ' (not installed)';
  if (status.updateRequired) return `@${status.version} — update required`;
  if (status.updateAvailable) return `@${status.version} — update available`;
  return `@${status.version}`;
}

function statusColor(status: McpCliStatus | null): string {
  if (!status || !status.installed) return 'bg-text-muted';
  if (status.updateRequired) return 'bg-danger';
  if (status.updateAvailable) return 'bg-warning';
  return 'bg-success';
}

interface McpCliStatusRowProps {
  status: McpCliStatus | null;
  installing: boolean;
  onInstall: () => void;
}

/**
 * Shows whether the actorium-mcp CLI binary itself is installed and on
 * PATH — distinct from AgentStatusList below, which is per-agent
 * *registration* (a binary can be installed with no agent registered yet).
 * `updateRequired` mirrors the extension's own force-update gate (see
 * VersionChecker): the backend can mark an installed CLI version as no
 * longer supported, same as it can for the extension itself.
 */
export function McpCliStatusRow({ status, installing, onInstall }: McpCliStatusRowProps) {
  const needsAction =
    !status || !status.installed || status.updateRequired || status.updateAvailable;
  return (
    <div
      title={
        status?.installed ? `actorium-mcp v${status.version}` : 'actorium-mcp CLI not found on PATH'
      }
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5"
    >
      <span className="relative shrink-0">
        <CliIcon name="actorium-mcp" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-bg ${statusColor(status)}`}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
        actorium-mcp
        <span className="text-text-muted">{versionSuffix(status)}</span>
      </span>
      {needsAction && (
        <button
          type="button"
          disabled={installing}
          onClick={onInstall}
          className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-accent-foreground hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-60"
        >
          {installing && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />}
          {installing ? 'Installing…' : status?.installed ? 'Update' : 'Install'}
        </button>
      )}
    </div>
  );
}
