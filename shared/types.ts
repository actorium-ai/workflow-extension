// ── Version management ────────────────────────────────────────────────────
// GET /extension/version on workflow-bff — a BFF-native, public (no-auth)
// endpoint, not proxied to hermes-agent. Called on activation, before the
// developer has logged in, so it can show an update banner without a token.

export interface VersionInfo {
  vscode: VersionEntry;
  actorium_mcp: McpVersionEntry;
}

export interface VersionEntry {
  min_version: string;
  recommended_version: string;
  marketplace_url: string;
  deprecation_notice: string | null;
}

/** Same version-gate shape as VersionEntry, but for the actorium-mcp CLI the
 * extension shells out to — npm_package replaces marketplace_url since
 * there's no marketplace listing, just an `npm install -g <package>` the
 * extension runs on the user's behalf. */
export interface McpVersionEntry {
  min_version: string;
  recommended_version: string;
  npm_package: string;
  deprecation_notice: string | null;
}

// ── OAuth / Auth ──────────────────────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  /** Relative path (e.g. "/oauth/device/authorize") — user-service does not
   * send an absolute verification_uri_complete; callers must build the full
   * URL themselves (base + verification_uri + ?user_code=...). */
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

// ── Org / Workspace listing (IDE first-connect picker) ────────────────────
// Fetched via the device-flow JWT directly — GET /coding/me on user-service
// (same physical /api/me the browser hits via its BFF session; the IDE
// reaches it through a different, auth-exempt BFF path — see
// RequireBFFIdentityOrCodingJWT) and GET /api/coding/workspaces?org=<id> on
// workflow-backend. No BFF session in either case.

/** Only the fields the IDE picker needs from GET /coding/me's response. */
export interface MeMembership {
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  role: string;
  member_count: number;
  workspace_count: number;
}

/** Only the fields the IDE's account menu needs from GET /api/me's user block
 * (user-service's MeUser has more — linked_providers etc. — omitted here). */
export interface MeUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string;
}

export interface MeResponse {
  user: MeUser;
  memberships: MeMembership[];
}

export interface WorkspaceSummary {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
}

/** Envelope both user-service and workflow-backend wrap success responses in. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface FeatureInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
}

// ── Workspace detail / features (IDE) ──────────────────────────────────────
// GET /coding/workspaces/:id on workflow-backend (reuses the browser's
// /api/workspaces/:id — see WorkspaceDetail in workflow-backend's dto.go).

export interface FeatureTaskCounts {
  total: number;
  done: number;
  in_progress: number;
  blocked: number;
  ready: number;
  todo: number;
}

/** Per-stage review state, keyed by stage (product_spec/tech_design/tasks/
 * handoff) — mirrors digital-factory-ui's StageReview, used to show an
 * approved checkmark on the feature-detail tab strip. */
export interface StageReview {
  review_status?: string | null;
}

export interface FeatureSummary {
  id: string;
  feature_name: string;
  title: string;
  status: string;
  current_stage: string;
  stages?: Record<string, StageReview>;
  next_action: string;
  task_counts: FeatureTaskCounts;
  updated_at: string;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  features: FeatureSummary[];
  tasks: TaskSummary[];
}

// ── Workspace repos ─────────────────────────────────────────────────────────
// GET /api/workspaces/:id/repos on workflow-backend (reuses the browser's own
// endpoint — see WorkspaceRepo in workflow-backend's dto.go). `repo_id` is
// the human-readable repo name (matches the local clone's folder name), used
// to cross-reference against repoLinker.ts's locally-linked symlinks.

export interface WorkspaceRepo {
  id: string;
  repo_id: string;
  repo_url: string | null;
  base_branch: string | null;
  is_management_repo: boolean;
}

// ── Feature tasks (IDE) ─────────────────────────────────────────────────────
// GET /api/workspaces/:wid/features/:featureId/tasks on workflow-backend
// (reuses the browser's own task list endpoint — see TaskSummary in
// workflow-backend's dto.go). Only the fields the navigator's expandable
// feature-task rows need are kept here (workflow-backend's TaskSummary has
// many more — repo/branch/execution/pr metadata, etc.).

export interface TaskSummary {
  id: string;
  task_name: string;
  feature_id: string;
  title: string;
  status: string;
  next_action?: string;
}

// ── Workspace activity (IDE) ────────────────────────────────────────────────
// GET /api/workspaces/:wid/activity?featureId=... on workflow-backend (same
// endpoint the browser's feature-detail Activity tab uses). Server-paginated
// (page/limit) as of the payload-size pass — see workflow-backend's
// ActivityScope.

export interface ActivityEvent {
  action: string;
  scope: string;
  actor: string;
  occurred_at: string;
  note?: string;
  feature_id?: string;
  task_id?: string;
  actor_id?: string;
  enriched: boolean;
}

// ── Feature task detail (IDE) ───────────────────────────────────────────────
// GET /workspaces/:wid/features/:fid/tasks/:tid on workflow-backend.
export interface ExecutionContext {
  actor_type: string;
  last_updated_by?: string;
  last_updated_at?: string;
}

export interface PullRequestRef {
  label: string;
  url: string;
  status: string;
  repo: string;
}

export interface TaskDetail {
  id: string;
  task_name: string;
  feature_id: string;
  feature_name: string;
  title: string;
  status: string;
  repo?: string;
  branch?: string;
  next_action?: string;
  is_blocked: boolean;
  blocked_reason?: string;
  blocked_details?: string;
  blocked_from_status?: string;
  conflict_state?: string;
  dispatched_at?: string;
  workspace_id: string;
  depends_on: string[];
  execution: ExecutionContext;
  pr_refs?: PullRequestRef[];
  activity: ActivityEvent[];
  model_id?: string;
}

// ── Task diff (IDE) ─────────────────────────────────────────────────────────
// GET /workspaces/:wid/tasks/:tid/diff?repo=&files_only= on workflow-backend.
export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface TaskDiff {
  files: PRFile[];
  total_additions: number;
  total_deletions: number;
  unified_diff: string;
  truncated?: boolean;
}

// ── Feature handoff (IDE) ───────────────────────────────────────────────────
// GET /workspaces/:wid/features/:fid/handoff on workflow-backend.
export interface HandoffPR {
  repo: string;
  pr_url: string | null;
  status: string;
  conflict_state: string;
}

export interface FeatureHandoff {
  created_at: string;
  prs: HandoffPR[];
}

// ── Workspace documents (IDE) ──────────────────────────────────────────────
// GET /coding/workspaces/:id/documents on storage-service (reuses the
// browser's /api/workspaces/:id/documents).

export interface StorageDocument {
  id: string;
  feature_id: string | null;
  path: string;
  title?: string;
}
