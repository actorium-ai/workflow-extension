import type {
  ActivityEvent,
  FeatureHandoff,
  FeatureSummary,
  HandoffPR,
  MeUser,
  StorageDocument,
  TaskDetail,
  TaskDiff,
  TaskSummary,
  VersionEntry,
} from '@workflow-extension/shared';

export type {
  ActivityEvent,
  FeatureHandoff,
  FeatureSummary,
  HandoffPR,
  MeUser,
  StorageDocument,
  TaskDetail,
  TaskDiff,
  TaskSummary,
  VersionEntry,
};

/** One repo the current workspace tracks (see the extension host's
 * src/navigator/workflow-api.ts getWorkspaceRepos), cross-referenced against
 * what's actually symlinked into the local workspace folder (see
 * src/workspace/repoLinker.ts) — `linked` is false when the workspace knows
 * about this repo but no local clone has been linked yet, in which case
 * `target` is absent. */
export interface LinkedRepo {
  name: string;
  target?: string;
  linked: boolean;
}

/** Local coding agents the extension knows how to register actorium-mcp
 * with (see the extension host's src/workspace/mcpConnect.ts). */
export type AgentTarget = 'claude' | 'codex' | 'opencode';

export interface AgentStatus {
  registered: boolean;
  /** Only meaningful when `registered` is true — undefined means we could
   * only confirm the config entry exists, not whether it currently works
   * (true for Codex/opencode, which have no live health check). */
  connected?: boolean;
  detail?: string;
}

export type AgentStatuses = Partial<Record<AgentTarget, AgentStatus>>;

/** Whether the actorium-mcp binary itself is installed on PATH, and how its
 * version compares to the backend's version-gate — distinct from
 * AgentStatus above, which is per-agent *registration*, not the CLI's own
 * presence/version. See the extension host's src/navigator/panel.ts
 * (_loadMcpCliStatus) for how this is computed. */
export interface McpCliStatus {
  installed: boolean;
  version?: string;
  npmPackage: string;
  /** Installed version is below the backend's min_version — hard block,
   * mirrors the extension's own force-update gate (see VersionChecker). */
  updateRequired: boolean;
  /** Installed version is below recommended_version but not min_version —
   * soft nudge. */
  updateAvailable: boolean;
}
