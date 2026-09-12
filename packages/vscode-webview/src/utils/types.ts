import type {
  AccountSummary,
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
  AccountSummary,
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
 * what's actually present in the local workspace folder (see
 * src/workspace/repoLinker.ts) — `linked` is false when the workspace knows
 * about this repo but no local clone/link exists yet, in which case `target`
 * is absent. */
export interface LinkedRepo {
  name: string;
  target?: string;
  linked: boolean;
  /** The workspace's known git URL for this repo, if any — absent for a
   * locally-linked repo the workspace API doesn't track. Drives the
   * per-row "Clone" action on not-yet-linked repos and "Clone all". */
  repoUrl?: string;
  /** The actual local symlink/folder name, present only when it differs
   * from `name` (the canonical repo_id) — e.g. a clone named "engine-ui"
   * linked as the "engine-dashboard" repo. Resolved via .actorium/
   * repo-links.json (see repoLinkManifest.ts), not by assuming the two
   * match. */
  linkName?: string;
  /** False for a repo cloned directly into the workspace folder (the
   * default for new clones), true for one linked in from elsewhere on disk
   * via "Actorium: Add Repo" (or an older clone made before direct-clone
   * was the default) — a plain direct clone has nothing to "unlink", so the
   * panel only offers that action when this is true. Undefined when
   * `linked` is false. */
  isSymlink?: boolean;
  /** True only when `isSymlink` is true and its target has since been
   * deleted — the panel renders this as a distinct "unlink" row instead of
   * the normal linked row, since the repo is still tracked but the local
   * folder it pointed at is gone. Cleared by the section's "Repair"
   * action, which removes the dangling link and its stale config entry. */
  broken?: boolean;
  /** Whichever branch is currently checked out locally (see the extension
   * host's src/git/gitApi.ts) — undefined for a not-yet-linked repo, a
   * broken symlink, or a detached HEAD. Purely informational; "Pull latest"
   * always pulls whatever this is, it never switches branches. */
  currentBranch?: string;
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
  /** Which account/workspace this registration was last written for — see
   * the extension host's mcpRegistrationState.ts. Undefined for a
   * registration made before that tracking existed. */
  boundAccountLabel?: string;
  boundWorkspaceLabel?: string;
  /** This registration is bound to a different account/workspace than the
   * one currently active — needs a Reconnect. */
  stale?: boolean;
  /** The on-disk MCP config was rewritten after this agent's CLI session was
   * last opened — restart it to pick up the change. Best-effort: the
   * extension can't observe whether that session is still running. */
  needsRestart?: boolean;
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

/** Whether this workspace's enabled skills (synced from workflow-backend's
 * skills registry — see the extension host's src/workspace/
 * technicalSkills.ts) are copied into this workspace folder's
 * target-specific skills directory (.claude/skills, .codex/skills, or
 * .opencode/skills). `installed` is false for a partial install (some but
 * not all synced), since "Install" always re-syncs the full set anyway. */
export interface TechnicalSkillsStatus {
  installed: boolean;
  total: number;
}

export type TechnicalSkillsStatuses = Partial<Record<AgentTarget, TechnicalSkillsStatus>>;
