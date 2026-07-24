import {
  type ApiSuccessResponse,
  CODING_IDE_SOURCE,
  type CreateSessionResponse,
  type FeatureSummary,
  type SessionMessage,
  type SessionSummary,
  type StorageDocument,
  type TaskSummary,
  type WorkspaceDetail,
} from '@workflow-extension/shared';

import { getActoriumConfig } from '../config/environment.js';

/**
 * Fetch helpers for the IDE's session-history, docs, and features data.
 * Docs/features/sessions all reuse the SAME plain /api/* routes the browser
 * calls now — bearer-JWT auth is a blanket alternative to a session cookie
 * on every auth_required route in workflow-bff (see its
 * internal/app/api/handler/proxy), so no dedicated /coding/* routes are
 * needed for any of them. Sessions are scoped to this client's own via
 * ?source=coding-ide rather than a separate path (see CODING_IDE_SOURCE).
 */

export interface CodingApiConfig {
  getToken: () => Promise<string | null>;
  agentUrl: string;
  workflowBackendUrl: string;
  storageServiceUrl: string;
}

/** How a webview panel provider reaches per-caller identity/workspace — small
 * enough to pass directly rather than injecting the whole AuthManager.
 * Shared by both ChatPanelProvider and NavigatorPanelProvider. */
export interface CodingApiContext {
  getToken: () => Promise<string | null>;
  getWorkspaceId: () => string | null;
}

export function codingApiConfig(ctx: CodingApiContext): CodingApiConfig {
  const { agentUrl, workflowBackendUrl, storageServiceUrl } = getActoriumConfig();
  return { getToken: ctx.getToken, agentUrl, workflowBackendUrl, storageServiceUrl };
}

async function authedFetch(
  config: CodingApiConfig,
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  const token = await config.getToken();
  if (!token) return null;
  return fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
}

/**
 * POST /session — create a new chat session for a new conversation. Must be
 * called once, before the first /chat turn — unlike the old /coding/chat,
 * /chat no longer creates a session lazily (see ChatTurnRequest's doc
 * comment in shared/types.ts). Tagged `source: CODING_IDE_SOURCE` so this
 * client's own sessions are listable separately from the browser's.
 */
export async function createSession(
  config: CodingApiConfig,
  workspaceId: string,
  featureId = '',
): Promise<string | null> {
  const resp = await authedFetch(config, `${config.agentUrl}/api/v1/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: workspaceId,
      feature_id: featureId,
      source: CODING_IDE_SOURCE,
    }),
  });
  if (!resp?.ok) return null;
  const body = (await resp.json()) as CreateSessionResponse;
  return body.session_id;
}

/** GET /sessions?source=coding-ide — the caller's own IDE chat sessions. */
export async function listSessions(
  config: CodingApiConfig,
  workspaceId: string,
  featureId = '',
): Promise<SessionSummary[] | null> {
  const qs = new URLSearchParams({
    workspace_id: workspaceId,
    feature_id: featureId,
    source: CODING_IDE_SOURCE,
  });
  const resp = await authedFetch(config, `${config.agentUrl}/api/v1/sessions?${qs}`);
  if (!resp?.ok) return null;
  const body = (await resp.json()) as { sessions: SessionSummary[] };
  return body.sessions;
}

/** GET /sessions/{id}/messages — a session's full transcript. */
export async function getSessionMessages(
  config: CodingApiConfig,
  sessionId: string,
): Promise<SessionMessage[] | null> {
  const resp = await authedFetch(
    config,
    `${config.agentUrl}/api/v1/sessions/${sessionId}/messages`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as { messages: SessionMessage[] };
  return body.messages;
}

/** DELETE /sessions/{id}. */
export async function deleteSession(config: CodingApiConfig, sessionId: string): Promise<boolean> {
  const resp = await authedFetch(config, `${config.agentUrl}/api/v1/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  return !!resp?.ok;
}

/** GET /api/workspaces/{id} — workspace detail including features (the SAME
 * endpoint the browser hits). */
export async function getWorkspaceDetail(
  config: CodingApiConfig,
  workspaceId: string,
): Promise<WorkspaceDetail | null> {
  const resp = await authedFetch(
    config,
    `${config.workflowBackendUrl}/api/workspaces/${workspaceId}`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as ApiSuccessResponse<WorkspaceDetail>;
  return body.data;
}

/** Convenience wrapper — just the features array from getWorkspaceDetail. */
export async function listFeatures(
  config: CodingApiConfig,
  workspaceId: string,
): Promise<FeatureSummary[] | null> {
  const detail = await getWorkspaceDetail(config, workspaceId);
  return detail?.features ?? null;
}

/** GET /api/workspaces/{wid}/features/{featureId}/tasks — a single feature's
 * task list (the SAME endpoint the browser's board feature-list-view hits
 * when a feature row is expanded), capped at 100 (well above any real
 * feature's task count) since the navigator's expandable row has no
 * pagination UI of its own. */
export async function getFeatureTasks(
  config: CodingApiConfig,
  workspaceId: string,
  featureId: string,
): Promise<TaskSummary[] | null> {
  const resp = await authedFetch(
    config,
    `${config.workflowBackendUrl}/api/workspaces/${workspaceId}/features/${featureId}/tasks?limit=100`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as ApiSuccessResponse<{ items: TaskSummary[] }>;
  return body.data.items;
}

/** GET /api/workspaces/{id}/documents — every doc in the workspace (the SAME
 * endpoint the browser hits). */
export async function listDocuments(
  config: CodingApiConfig,
  workspaceId: string,
): Promise<StorageDocument[] | null> {
  const resp = await authedFetch(
    config,
    `${config.storageServiceUrl}/api/workspaces/${workspaceId}/documents`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as { documents: StorageDocument[] };
  return body.documents;
}

/**
 * A StorageDocument's `path` (from list endpoints) is workspace-relative —
 * e.g. "docs/features/<slug>/product_spec.md" — but storage-service's
 * per-document lookups (content/raw) key on the document's internal,
 * feature-relative path column instead (just "product_spec.md"); the
 * workspace-relative form is synthesized at read time by prefixing
 * "docs/features/<slug-or-id>/" (see storage-service's
 * featureRelativePathUnchecked/FeatureRelativePath). Stripping that same
 * fixed 3-segment prefix recovers the value those lookups actually expect —
 * unambiguous since the prefix format has no other meaning in this scheme.
 */
function toFeatureRelativePath(doc: Pick<StorageDocument, 'path' | 'feature_id'>): string {
  if (!doc.feature_id) return doc.path;
  const parts = doc.path.split('/');
  if (parts[0] === 'docs' && parts[1] === 'features' && parts.length > 3) {
    return parts.slice(3).join('/');
  }
  return doc.path;
}

/** GET /api/workspaces/{wid}/(features/{featureId}/)?documents/content?path=...
 * — a document's content as REAL markdown text (storage-service decodes the
 * underlying ProseMirror/Yjs collaborative-editor snapshot and converts it
 * via ProseMirrorToMarkdown). This is the ONLY correct way to read a
 * canonical feature doc (product_spec.md/tech_design.md/tasks.md/
 * handoff.md) as text — those are stored as ProseMirror JSON, not plain
 * markdown, so fetching their raw bytes (getDocumentRaw below) returns that
 * JSON structure verbatim instead of readable text. Returns null if the doc
 * isn't decodable this way (e.g. a plain uploaded file that was never
 * opened in the collaborative editor, or a live-edited doc with no synced
 * text snapshot yet) — callers should fall back to getDocumentRaw then. */
export async function getDocumentContent(
  config: CodingApiConfig,
  workspaceId: string,
  doc: Pick<StorageDocument, 'path' | 'feature_id'>,
): Promise<string | null> {
  const base = doc.feature_id
    ? `${config.storageServiceUrl}/api/workspaces/${workspaceId}/features/${doc.feature_id}/documents/content`
    : `${config.storageServiceUrl}/api/workspaces/${workspaceId}/documents/content`;
  const qs = new URLSearchParams({ path: toFeatureRelativePath(doc) });
  const resp = await authedFetch(config, `${base}?${qs}`);
  if (!resp?.ok) return null;
  const body = (await resp.json()) as { content: string };
  return body.content;
}

/** GET /api/workspaces/{wid}/(features/{featureId}/)?documents/raw?path=...
 * — a document's raw stored bytes + content-type (works for any file,
 * including binary — but for the three canonical collaborative docs this is
 * their internal ProseMirror JSON, not readable text; use
 * getDocumentContent for those). Routed through the feature-scoped variant
 * when the doc has a feature_id (storage-service's FindByFeaturePath matches
 * on exact feature_id + path), since many workspace documents (e.g.
 * per-service DB changelogs, or docs from a feature/repo the IDE doesn't
 * have checked out) have no local copy in the currently open workspace
 * folder — this is the fallback for those. */
export async function getDocumentRaw(
  config: CodingApiConfig,
  workspaceId: string,
  doc: Pick<StorageDocument, 'path' | 'feature_id'>,
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const base = doc.feature_id
    ? `${config.storageServiceUrl}/api/workspaces/${workspaceId}/features/${doc.feature_id}/documents/raw`
    : `${config.storageServiceUrl}/api/workspaces/${workspaceId}/documents/raw`;
  const qs = new URLSearchParams({ path: toFeatureRelativePath(doc) });
  const resp = await authedFetch(config, `${base}?${qs}`);
  if (!resp?.ok) return null;
  const data = await resp.arrayBuffer();
  const contentType = resp.headers.get('content-type') ?? 'application/octet-stream';
  return { data, contentType };
}

/** GET /tools?source=coding-ide — the live tool registry, for the `/`
 * slash-command picker. Mirrors digital-factory-ui's listTools() (same
 * endpoint, same response shape) — the extension's own hardcoded clear/
 * mode-ask/mode-plan/mode-auto commands are gone; `/` now offers the same
 * tool-name-derived commands the web app does, just the IDE's own toolset
 * (run_command, search_code, edit_file, ...) rather than the web workflow
 * chat's (write_product_spec, create_tasks, ...) — the `source` param is
 * what tells the backend which of the two to return; omitting it (as
 * digital-factory-ui's own call does) gets the workflow one. */
export async function listTools(
  config: CodingApiConfig,
): Promise<Array<{ name: string; description: string }> | null> {
  const resp = await authedFetch(config, `${config.agentUrl}/api/v1/tools?source=coding-ide`);
  if (!resp?.ok) return null;
  const body = (await resp.json()) as { tools: Array<{ name: string; description: string }> };
  return body.tools;
}

/**
 * POST /api/workspaces/{workspaceId}/images — upload a pasted image to
 * storage-service, returning its id for a /chat request's image_ids (see
 * ChatTurnRequest — already accepted end-to-end server-side, no backend
 * changes needed). Mirrors digital-factory-ui's own uploadImage exactly
 * (same endpoint, same multipart shape) — bearer-JWT auth here instead of a
 * session cookie, matching every other call in this file. Returns null on
 * any failure (missing token/workspace, network error, non-2xx) — the
 * caller marks the pending image as failed rather than surfacing a toast,
 * matching how a failed local tool call degrades gracefully elsewhere here.
 */
export async function uploadImage(
  config: CodingApiConfig,
  workspaceId: string,
  data: Uint8Array,
  mimeType: string,
): Promise<string | null> {
  const token = await config.getToken();
  if (!token) return null;
  try {
    const ext = mimeType.split('/')[1] ?? 'png';
    const form = new FormData();
    form.append('file', new Blob([data], { type: mimeType }), `pasted-image.${ext}`);
    const resp = await fetch(`${config.storageServiceUrl}/api/workspaces/${workspaceId}/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { id?: string; data?: { id?: string } };
    return body.id ?? body.data?.id ?? null;
  } catch {
    return null;
  }
}
