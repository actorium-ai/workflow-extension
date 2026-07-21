// ── Chat message types ────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_call_id?: string;
  name?: string;
}

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

export interface ToolResultPayload {
  ok: boolean | null;
  applied?: boolean;
  content?: string;
  error?: string;
  files?: FileEntry[];
  path?: string;
  [key: string]: unknown;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

// ── Deferred tool execution ───────────────────────────────────────────────

export interface DeferredToolCall {
  type: 'hermes.tool.deferred';
  tool_call_id: string;
  tool: string;
  params: Record<string, unknown>;
}

// ── IDE context sent to the agent ─────────────────────────────────────────

export interface IDEContext {
  active_file: string | null;
  selection: TextSelection | null;
  open_files: string[];
  workspace_root: string | null;
  git_status: GitContext | null;
  diagnostics: DiagnosticInfo[];
}

export interface TextSelection {
  start_line: number;
  end_line: number;
  text: string;
}

export interface GitContext {
  branch: string | null;
  modified: string[];
  staged: string[];
  untracked: string[];
  remote_url: string | null;
}

export interface DiagnosticInfo {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
}

// ── Chat request / response ───────────────────────────────────────────────

export interface CodingChatRequest {
  messages: ChatMessage[];
  workspace_id: string | null;
  feature_id: string | null;
  repo_path: string | null;
  context: IDEContext;
  mode: OperationalMode;
}

export type OperationalMode = 'ask' | 'plan' | 'auto';

// ── Version management ────────────────────────────────────────────────────

export interface VersionInfo {
  vscode: VersionEntry;
  jetbrains: VersionEntry;
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
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

// ── Workspace / Feature listing ───────────────────────────────────────────

export interface WorkspaceInfo {
  id: string;
  name: string;
  org_id: string;
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
