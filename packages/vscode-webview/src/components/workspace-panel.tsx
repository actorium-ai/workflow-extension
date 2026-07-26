import { AtSign, FolderGit2 } from 'lucide-react';

import type { AgentStatuses, AgentTarget, LinkedRepo, McpCliStatus } from '../utils/types.ts';
import { AgentStatusList } from './agent-status-list.tsx';
import { McpCliStatusRow } from './mcp-cli-status.tsx';

function repoTag(repo: LinkedRepo): string {
  return `repo "${repo.name}"`;
}

interface WorkspacePanelProps {
  repos: LinkedRepo[];
  hasWorkspaceFolder: boolean;
  onOpenWorkspaceFolder: () => void;
  mcpCliStatus: McpCliStatus | null;
  mcpCliInstalling: boolean;
  onInstallMcpCli: () => void;
  mcpStatuses: AgentStatuses;
  pendingAgents: Set<AgentTarget>;
  onConnectAgent: (target: AgentTarget) => void;
  onDisconnectAgent: (target: AgentTarget) => void;
  /** Inserts a plain-text reference to a repo into the active terminal (or
   * clipboard, if none) — see NavigatorPanelProvider's tagInPrompt handler
   * and FeatureList/DocList's matching onTagInPrompt. */
  onTagInPrompt: (text: string) => void;
}

/** Lists the repos symlinked into the current org's local workspace folder
 * (see the extension host's src/workspace/repoLinker.ts) and lets the user
 * add more or jump into the folder — the local surface a coding agent like
 * Claude Code actually works from, as opposed to Docs/Features below which
 * read live workspace data over the network. Every repo is a symlink
 * directly inside the workspace folder, so clicking one just opens that same
 * root (in the current window) rather than a separate "just this repo"
 * folder — the root's Explorer already surfaces it. */
export function WorkspacePanel({
  repos,
  hasWorkspaceFolder,
  onOpenWorkspaceFolder,
  mcpCliStatus,
  mcpCliInstalling,
  onInstallMcpCli,
  mcpStatuses,
  pendingAgents,
  onConnectAgent,
  onDisconnectAgent,
  onTagInPrompt,
}: WorkspacePanelProps) {
  if (!hasWorkspaceFolder) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-3 text-center">
        <p className="text-xs text-text-muted">
          Link a local folder to work on this workspace with Claude Code or another local coding
          agent.
        </p>
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary-hover"
          onClick={onOpenWorkspaceFolder}
        >
          Link workspace folder
        </button>
      </div>
    );
  }

  return (
    <div className="px-1">
      {repos.length === 0 ? (
        <div className="px-2 py-3 text-center text-xs text-text-muted">No repos linked yet.</div>
      ) : (
        repos.map((repo) => (
          <div
            key={repo.name}
            className="group flex w-full items-center gap-1.5 rounded-md pr-1 hover:bg-surface-secondary"
          >
            <button
              type="button"
              title={repo.target}
              onClick={onOpenWorkspaceFolder}
              className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
            >
              <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                {repo.name}
              </span>
            </button>
            <button
              type="button"
              title="Tag this repo in the terminal prompt"
              onClick={() => onTagInPrompt(repoTag(repo))}
              className="shrink-0 rounded p-1 text-text-muted opacity-0 hover:bg-surface-secondary hover:text-text-primary group-hover:opacity-100"
            >
              <AtSign className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          </div>
        ))
      )}

      <div className="mx-2 my-1 border-t border-border" />

      <McpCliStatusRow
        status={mcpCliStatus}
        installing={mcpCliInstalling}
        onInstall={onInstallMcpCli}
      />

      <AgentStatusList
        statuses={mcpStatuses}
        pendingAgents={pendingAgents}
        onConnect={onConnectAgent}
        onDisconnect={onDisconnectAgent}
      />
    </div>
  );
}
