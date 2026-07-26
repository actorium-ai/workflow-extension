import type {
  ActivityEvent,
  ApiSuccessResponse,
  FeatureHandoff,
  FeatureSummary,
  StorageDocument,
  TaskDetail,
  TaskDiff,
  TaskSummary,
  WorkspaceDetail,
  WorkspaceRepo,
} from '@workflow-extension/shared';

import { getActoriumConfig } from '../config/environment.js';

/**
 * Fetch helpers for the Navigator's docs/features data. Both reuse the SAME
 * plain /api/* routes the browser calls — bearer-JWT auth is a blanket
 * alternative to a session cookie on every auth_required route in
 * workflow-bff (see its internal/app/api/handler/proxy), so no dedicated
 * /coding/* routes are needed for either.
 */

export interface CodingApiConfig {
  getToken: () => Promise<string | null>;
  workflowBackendUrl: string;
  storageServiceUrl: string;
}

/** How a webview panel provider reaches per-caller identity/workspace — small
 * enough to pass directly rather than injecting the whole AuthManager. */
export interface CodingApiContext {
  getToken: () => Promise<string | null>;
  getWorkspaceId: () => string | null;
}

export function codingApiConfig(ctx: CodingApiContext): CodingApiConfig {
  const { workflowBackendUrl, storageServiceUrl } = getActoriumConfig();
  return { getToken: ctx.getToken, workflowBackendUrl, storageServiceUrl };
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

/** GET /api/workspaces/{wid}/activity?featureId=... — a feature's activity
 * feed (the SAME endpoint the browser's feature-detail Activity tab hits),
 * audience=client for the curated human-friendly action set. Capped at 100
 * (well above what the detail tab's Activity tab needs to show) since it has
 * no pagination UI of its own. */
export async function getFeatureActivity(
  config: CodingApiConfig,
  workspaceId: string,
  featureId: string,
): Promise<ActivityEvent[] | null> {
  const resp = await authedFetch(
    config,
    `${config.workflowBackendUrl}/api/workspaces/${workspaceId}/activity?featureId=${featureId}&audience=client&limit=100`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as ApiSuccessResponse<ActivityEvent[]>;
  return body.data;
}

/** GET /api/workspaces/{wid}/features/{featureId}/tasks?limit=... — a
 * feature's task list (the SAME endpoint the browser's Tasks tab hits).
 * Capped at 200 — well above what a single feature's task list needs — since
 * it has no pagination UI of its own. */
export async function getFeatureTasks(
  config: CodingApiConfig,
  workspaceId: string,
  featureId: string,
): Promise<TaskSummary[] | null> {
  const resp = await authedFetch(
    config,
    `${config.workflowBackendUrl}/api/workspaces/${workspaceId}/features/${featureId}/tasks?limit=200`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as ApiSuccessResponse<{ items: TaskSummary[] }>;
  return body.data.items;
}

/** GET /api/workspaces/{wid}/features/{featureId}/tasks/{taskId} — a single
 * task's full detail (execution context, PR refs, per-task activity, blocked
 * state) for the task-detail tab. */
export async function getTaskDetail(
  config: CodingApiConfig,
  workspaceId: string,
  featureId: string,
  taskId: string,
): Promise<TaskDetail | null> {
  const resp = await authedFetch(
    config,
    `${config.workflowBackendUrl}/api/workspaces/${workspaceId}/features/${featureId}/tasks/${taskId}`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as ApiSuccessResponse<TaskDetail>;
  return body.data;
}

/** GET /api/workspaces/{wid}/tasks/{taskId}/diff?repo=... — a task's PR file
 * list + unified diff, for the task-detail tab's Diff sub-tab. */
export async function getTaskDiffContent(
  config: CodingApiConfig,
  workspaceId: string,
  taskId: string,
  repo: string,
): Promise<TaskDiff | null> {
  const qs = new URLSearchParams({ repo });
  const resp = await authedFetch(
    config,
    `${config.workflowBackendUrl}/api/workspaces/${workspaceId}/tasks/${taskId}/diff?${qs}`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as ApiSuccessResponse<TaskDiff>;
  return body.data;
}

/** GET /api/workspaces/{wid}/features/{featureId}/handoff — a go-owned
 * feature's handoff PR table (repo/status/conflict-state per repo). 404s
 * when the feature isn't go-owned or has no handoff row yet. */
export async function getFeatureHandoff(
  config: CodingApiConfig,
  workspaceId: string,
  featureId: string,
): Promise<FeatureHandoff | null> {
  const resp = await authedFetch(
    config,
    `${config.workflowBackendUrl}/api/workspaces/${workspaceId}/features/${featureId}/handoff`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as ApiSuccessResponse<FeatureHandoff>;
  return body.data;
}

/** GET /api/workspaces/{id}/repos — every repo this workspace actually
 * tracks (the SAME endpoint the browser's Repositories settings page hits),
 * used to tell which of a user's locally-linked-repo symlinks correspond to
 * a real workspace repo, and which workspace repos have no local link yet. */
export async function getWorkspaceRepos(
  config: CodingApiConfig,
  workspaceId: string,
): Promise<WorkspaceRepo[] | null> {
  const resp = await authedFetch(
    config,
    `${config.workflowBackendUrl}/api/workspaces/${workspaceId}/repos`,
  );
  if (!resp?.ok) return null;
  const body = (await resp.json()) as ApiSuccessResponse<WorkspaceRepo[]>;
  return body.data;
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
