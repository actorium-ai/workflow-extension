// ── Mention/command tag format ──────────────────────────────────────────
// Canonical wire/display syntax for every mention/command kind the chat
// composer can insert: <p:handle> (person), <ft:slug> (feature), <d:slug/
// path> (doc), <cmd:tool-name> (slash command), <lf:path> (local file).
// Whatever trigger the user typed to open a picker (@, #, //, /, or a
// hand-typed tag) or however a row was clicked/dragged in from the
// navigator, insertion always produces this ONE canonical form — the
// renderer and the pre-send resolve step (panel.ts's _resolveMentions) only
// ever need to understand this single tag syntax, never the historical bare
// @handle/#slug-path/\/\/slug/leading-\/command forms.
//
// Kept in this single-file package (rather than a separate mention-tags.ts
// re-exported from here) deliberately — this package's own package.json
// points `main`/`types` directly at this file as a TS source (no compiled
// dist), which the webview's Vite bundler resolves fine but which broke at
// plain-Node runtime (packages/vscode's own `tsc`-compiled test suite) when
// this lived in a second file re-exported via `export * from
// './mention-tags.js'` — Node's native TS type-stripping loader resolved
// this file's own package-main entry correctly but not a relative import
// from within it. One file avoids the cross-file resolution edge case
// entirely, and matches this package's existing "one flat file" shape.

export type MentionTagKind = 'p' | 'ft' | 'd' | 'cmd' | 'lf';

/** Matches every canonical tag anywhere in a string. Capture group 1 is the
 * kind letter, group 2 is the raw value. */
export const MENTION_TAG_PATTERN = /<(p|ft|d|cmd|lf):([^<>\s][^<>]*)>/g;

/** Matches an UNCLOSED tag ending at the string's end (no trailing ">"
 * yet) — used to detect "the user is mid-way through hand-typing a tag"
 * while composing, so the matching picker can open and live-filter. */
export const OPEN_MENTION_TAG_PATTERN = /<(p|ft|d|cmd|lf):([^<>]*)$/;

export function buildMentionTag(kind: MentionTagKind, value: string): string {
  return `<${kind}:${value}>`;
}

/** Display/CSS "chip kind" for a tag letter — a separate, more readable
 * vocabulary from the wire-format letter (e.g. 'd' -> 'file' reads better
 * as a `data-chip` value / in conditional rendering than 'd' does). */
export const CHIP_KIND_FOR_TAG: Record<MentionTagKind, string> = {
  p: 'mention',
  ft: 'feature',
  d: 'file',
  cmd: 'command',
  lf: 'localfile',
};

// ── Tool call / tool result ───────────────────────────────────────────────

export interface ToolCall {
  tool_call_id: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  tool: string;
  result: ToolResultPayload;
}

/** Real line-diff stats for an edit_file/write_file result — computed from
 * the actual before/after file content (see FileOps.editFile), not a
 * heuristic over the tool call's params. Mirrors opencode's server-side
 * `filediff` metadata (packages/opencode/src/tool/edit.ts), adapted for this
 * extension's architecture where the IDE — not hermes-agent — is the one
 * with real file access, so the stat is computed here, not on the backend. */
export interface FileDiffStat {
  additions: number;
  deletions: number;
  /** Unified diff text (via the `diff` package's createPatch) — lets the
   * webview render a real colored diff view instead of a raw JSON dump when
   * expanding a completed edit_file/write_file call. */
  patch?: string;
}

export interface ToolResultPayload {
  ok: boolean | null;
  applied?: boolean;
  content?: string;
  error?: string;
  files?: FileEntry[];
  path?: string;
  diff?: FileDiffStat;
  [key: string]: unknown;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

// ── Clarify prompt ─────────────────────────────────────────────────────────
// The `clarify` tool blocks the agent's turn server-side waiting for an
// answer (see hermes-agent's agent_dispatch.py::_make_clarify_callback) and
// publishes an `agent.clarify` SSE event with this shape. Answering goes
// through POST /threads/{session_id}/clarify with {clarify_id, response} —
// a session_id-scoped endpoint (not thread-specific despite the URL),
// reachable with the same identity/session_id /chat already uses; see
// digital-factory-ui's clarify-prompt.tsx for the reference implementation
// this mirrors.

export interface ClarifyPromptState {
  clarifyId: string;
  /** Already stripped of the "(select all that apply)" multi-select marker. */
  question: string;
  /** Up to a handful of predefined choices; null/empty means open-ended. */
  choices: string[] | null;
  /** True when the question ended with "(select all that apply)" — renders
   * checkboxes (any number of picks, joined into one answer) instead of a
   * single-pick radio list. */
  multiple: boolean;
  /** False once answered — hides/disables the prompt without removing it. */
  active: boolean;
  /** What the user picked/typed, once answered. */
  answer?: string | null;
}

// ── Ask-mode approval prompt ───────────────────────────────────────────────
// Ask mode used to block on a native vscode.window.showInformationMessage
// popup (Approve/Reject) from ModeGate._handleAsk. That's disconnected from
// the chat and only offers two choices. This renders an inline card instead,
// at the tool call's position in the flow, mirroring Claude Code's own Ask
// UX: Yes / Yes-allow-all-this-session / No / free-text "tell it what to do
// instead". Resolution never leaves the extension host — there's no server
// round trip like clarify's, since Ask-mode enforcement is entirely
// client-side (see ModeGate) — so this is answered via a postMessage back to
// extension.ts, which resolves the Promise ModeGate.handle() is awaiting.

export type ApprovalChoice = 'yes' | 'yes_all' | 'no' | 'instructions';

export interface ApprovalPromptState {
  callId: string;
  tool: string;
  params: Record<string, unknown>;
  /** False once answered — hides/disables the prompt without removing it. */
  active: boolean;
  choice?: ApprovalChoice;
}

// ── Deferred tool execution ───────────────────────────────────────────────

export interface DeferredToolCall {
  type: 'hermes.tool.deferred';
  tool_call_id: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface IDEFileContext {
  path: string;
  language: string;
  cursor_line: number;
  selection: string | null;
}

export interface IDEContext {
  active_file: string;
  active_file_language: string;
  cursor_line: number;
  selection: string | null;
  open_files: IDEFileContext[];
  git_branch: string;
  git_status: string;
  diagnostics: string;
  workspace_root: string;
}

// ── Chat request / response ───────────────────────────────────────────────
// POST /chat on hermes-agent (src/api/routers/chat.py) — the one chat
// endpoint shared by the browser and the IDE. Stateful: the server loads
// prior turns itself from `session_id`, so unlike the old IDE-only
// /coding/chat this only ever carries the LATEST message, never a resent
// history array. `ide_context`'s mere presence (vs. omitted for the
// browser) is what tells the backend's per-turn triage this turn can
// dispatch a coding verdict to opencode instead of redirecting to "use your
// IDE" — see agent_dispatch.py. `mode` (Ask/Plan/Auto) is enforced entirely
// client-side by ModeGate and is never part of this request.

export interface ChatTurnRequest {
  session_id: string;
  message: string;
  workspace_id?: string;
  feature_id?: string;
  model?: string;
  image_ids?: string[];
  ide_context?: IDEContext;
}

export type OperationalMode = 'ask' | 'plan' | 'auto';

// ── Session lifecycle ─────────────────────────────────────────────────────
// POST /session on hermes-agent (src/api/routers/sessions.py) — must be
// called once, before the first /chat turn of a new conversation, since
// unlike the old /coding/chat this session-owning /chat no longer creates
// one lazily. `source` tags IDE-created sessions so GET /sessions?source=...
// can list just this client's own sessions.

/** Session source tag for IDE-created sessions — see CreateSessionRequest.source. */
export const CODING_IDE_SOURCE = 'coding-ide';

export interface CreateSessionRequest {
  workspace_id?: string;
  feature_id?: string;
  source?: string;
}

export interface CreateSessionResponse {
  session_id: string;
}

// ── Model picker (IDE chat) ────────────────────────────────────────────────
// GET /models — same model_catalog table the browser app's picker reads
// (src/api/model_catalog.py).

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
}

export interface ModelsResponse {
  models: ModelOption[];
  /** Catalog's is_default model id, or "" if none is marked default. */
  default: string;
}

// ── Version management ────────────────────────────────────────────────────
// GET /extension/version on workflow-bff — a BFF-native, public (no-auth)
// endpoint, not proxied to hermes-agent. Called on activation, before the
// developer has logged in, so it can show an update banner without a token.

export interface VersionInfo {
  vscode: VersionEntry;
}

export interface VersionEntry {
  min_version: string;
  recommended_version: string;
  marketplace_url: string;
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

// ── Credit display ────────────────────────────────────────────────────────

export interface CreditInfo {
  balance: number;
  used: number;
  limit: number | null;
}

// ── Edit payload (used by edit_file tool) ─────────────────────────────────

export interface EditOperation {
  old_string: string;
  new_string: string;
}

export interface EditFileParams {
  path: string;
  edits: EditOperation[];
}

// ── SSE event types ───────────────────────────────────────────────────────

export type SSEEvent =
  | { type: 'chat.completion.chunk'; content: string }
  | {
      type: 'hermes.tool.deferred';
      tool_call_id: string;
      tool: string;
      params: Record<string, unknown>;
    }
  | { type: 'hermes.tool.progress'; tool_call_id: string; status: string }
  | { type: 'hermes.artifact.saved'; artifact_id: string }
  | { type: 'cost'; data: CreditInfo }
  | { type: 'done' }
  | { type: 'error'; error: string };

// ── Deferred tool-result reporting (opencode-backed IDE coding turns) ─────
// POST /coding/sessions/{session_id}/tool-result on hermes-agent
// (src/api/routers/chat.py) — resolves a hermes.tool.deferred call made by
// opencode's MCP bridge, which blocks synchronously inside a still-open
// /chat turn. Unlike the old /coding/chat flow, this does NOT end the turn
// or resend history — the same /chat SSE stream stays open and keeps
// streaming (more tool calls, then final text) once this unblocks it.

export interface ToolResultRequest {
  call_id: string;
  result: ToolResultPayload;
}

// ── Chat session history (IDE) ─────────────────────────────────────────────
// GET/POST/DELETE /sessions*, POST /session on hermes-agent
// (src/api/routers/sessions.py) — the same generic session routes the
// browser uses, scoped to this client's own sessions via ?source=coding-ide
// (see CreateSessionRequest.source above).

export interface SessionSummary {
  id: string;
  title: string;
  started_at: number;
  last_active_at: number;
  last_message_excerpt: string;
  model: string | null;
}

export interface SessionMessage {
  id: number;
  role: string;
  content: string | null;
  reasoning?: string | null;
  created_at: number;
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

export interface FeatureSummary {
  id: string;
  feature_name: string;
  title: string;
  status: string;
  current_stage: string;
  next_action: string;
  task_counts: FeatureTaskCounts;
  updated_at: string;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  features: FeatureSummary[];
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
  title: string;
  status: string;
  next_action?: string;
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
