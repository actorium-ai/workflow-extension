import type { FeatureSummary } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import {
  codingApiConfig,
  type CodingApiContext,
  listDocuments,
  listFeatures,
  listTools,
} from './coding-api';

/** Mirrors packages/vscode-webview/src/utils/types.ts's MentionItem — not
 * imported directly, since the extension host and the webview are separate
 * runtime contexts (Node.js vs. browser) even though they live in the same
 * monorepo; this package has never depended on webview-side files. */
export interface MentionItem {
  label: string;
  description: string;
  group?: string;
  insertValue?: string;
}

const FEATURE_STATUS_ORDER = [
  'backlog',
  'in_design',
  'in_tdd',
  'ready_for_implementation',
  'in_implementation',
  'in_handoff',
  'done',
  'blocked',
  'cancelled',
];

/**
 * Swaps `//{slug}` and `#{slug}/{path}` mention tokens in an outgoing
 * message for their backend feature UUID, right before sending — mirrors
 * digital-factory-ui's own resolveFeatureMentionIds/resolveFileMentionIds.
 * A message with no resolvable tokens (offline, no workspace, or the
 * feature list fetch fails) is returned unchanged rather than blocking send.
 */
export async function resolveMentions(
  text: string,
  codingApiCtx: CodingApiContext,
): Promise<string> {
  const workspaceId = codingApiCtx.getWorkspaceId();
  if (!workspaceId) return text;
  const features = await listFeatures(codingApiConfig(codingApiCtx), workspaceId);
  if (!features || features.length === 0) return text;

  const idBySlug = new Map(features.map((f) => [f.feature_name || f.id, f.id]));
  const withFeatureIds = text.replace(/<ft:([a-zA-Z0-9_-]+)>/g, (match, slug: string) => {
    const id = idBySlug.get(slug);
    return id ? `<ft:${id}>` : match;
  });
  return withFeatureIds.replace(
    /<d:([a-zA-Z0-9_-]+)(\/[\w./-]+)>/g,
    (match, slug: string, path: string) => {
      const id = idBySlug.get(slug);
      return id ? `<d:${id}${path}>` : match;
    },
  );
}

/**
 * Build the mention/command picker's item list for one trigger prefix
 * (`@`/`#`/`//`//`/`) — called from ChatPanelProvider's 'getMentions'
 * webview message handler, which just posts the result back as
 * 'mentionResults'. Kept prefix-dispatch shaped (not four separate exports)
 * since that's the natural mapping to the webview's own single
 * 'getMentions' request shape.
 */
export async function buildMentionItems(
  prefix: string,
  query: string,
  codingApiCtx: CodingApiContext,
): Promise<MentionItem[]> {
  switch (prefix) {
    case '@': {
      // Local file search via VS Code workspace.findFiles
      const pattern = query ? `**/*${query}*` : '**/*';
      const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 20);
      return uris.map((uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);
        return { label: relativePath, description: 'File' };
      });
    }

    case '#': {
      // Real workspace docs (storage-service, grouped by owning feature —
      // mirrors digital-factory-ui's FileMentionPicker) when connected to
      // a workspace; falls back to a local *.md search otherwise (offline,
      // not yet connected, or the fetch failed) so the picker still works.
      const workspaceId = codingApiCtx.getWorkspaceId();
      const [docs, features] = workspaceId
        ? await Promise.all([
            listDocuments(codingApiConfig(codingApiCtx), workspaceId),
            listFeatures(codingApiConfig(codingApiCtx), workspaceId),
          ])
        : [null, null];
      if (docs) {
        // d.feature_id is the feature's UUID — resolve it to the owning
        // FeatureSummary (for both the group header's display name and
        // the insert token's slug/root-segment below), rather than
        // showing the raw UUID.
        const featureById = new Map((features ?? []).map((f) => [f.id, f]));
        const q = query.toLowerCase();
        const filtered = q
          ? docs.filter(
              (d) => d.path.toLowerCase().includes(q) || (d.title ?? '').toLowerCase().includes(q),
            )
          : docs;
        // No cap here — mirrors digital-factory-ui's FileMentionPicker,
        // which renders every filtered match in a scrollable list rather
        // than truncating (see mention-dropdown.tsx's max-h-64
        // overflow-y-auto).
        return filtered.map((d) => {
          const basename = d.path.split('/').pop() || d.path;
          const feature = d.feature_id ? featureById.get(d.feature_id) : undefined;
          const featureSlug = feature ? feature.feature_name || feature.id : undefined;

          // Inserted token needs the FULL path relative to its root — the
          // owning feature's folder (stripping only the segment matching
          // the feature's slug/id, keeping any subpath under it, e.g.
          // "distributed-agent-team/subdir/tasks.md") for a feature doc,
          // or the reserved "_workspace" slug + the doc's full workspace-
          // relative path for one with no owning feature (e.g.
          // "_workspace/database/hermes-agent/v001/changelog.md") — mirrors
          // digital-factory-ui's insertFileMention exactly. A bare
          // basename here would collide for same-named files at different
          // paths (multiple changelog.md across different services) and
          // silently drop which one was actually meant.
          let insertValue: string;
          if (feature && featureSlug) {
            const segments = d.path.split('/');
            const idx = segments.findIndex((s) => s === featureSlug || s === feature.id);
            const relativePath = idx !== -1 ? segments.slice(idx + 1).join('/') : basename;
            insertValue = `${featureSlug}/${relativePath}`;
          } else {
            insertValue = `_workspace/${d.path}`;
          }

          return {
            label: d.title || basename,
            description: d.path,
            group: featureSlug || 'Workspace root',
            insertValue,
          };
        });
      }

      const pattern = query ? `**/*${query}*.md` : '**/*.md';
      const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 30);
      return uris.map((uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);
        const slash = relativePath.lastIndexOf('/');
        return {
          label: slash === -1 ? relativePath : relativePath.slice(slash + 1),
          description: relativePath,
          group: slash === -1 ? 'Workspace root' : relativePath.slice(0, slash),
        };
      });
    }

    case '//': {
      // Real workspace features (workflow-backend, mirrors
      // digital-factory-ui's FeatureMentionPicker) when connected;
      // otherwise an explanatory placeholder row (no fabricated list).
      const workspaceId = codingApiCtx.getWorkspaceId();
      const features = workspaceId
        ? await listFeatures(codingApiConfig(codingApiCtx), workspaceId)
        : null;
      if (features) {
        const q = query.toLowerCase();
        const filtered = q
          ? features.filter((f) => (f.feature_name || f.id).toLowerCase().includes(q))
          : features;

        const byStatus = new Map<string, FeatureSummary[]>();
        for (const f of filtered) {
          const list = byStatus.get(f.status) ?? [];
          list.push(f);
          byStatus.set(f.status, list);
        }
        const orderedStatuses = [
          ...FEATURE_STATUS_ORDER.filter((s) => byStatus.has(s)),
          ...[...byStatus.keys()].filter((s) => !FEATURE_STATUS_ORDER.includes(s)),
        ];
        const grouped = orderedStatuses.flatMap((s) => byStatus.get(s)!);

        // No cap here either — mirrors digital-factory-ui's
        // FeatureMentionPicker exactly (renders every filtered/grouped
        // feature in a scrollable list). The previous slice(0, 30) is what
        // was hiding "cancelled" features entirely in workspaces with 30+
        // features across earlier-ordered statuses (backlog/in_design/
        // .../done all come before "cancelled" in FEATURE_STATUS_ORDER, so
        // the budget was exhausted before reaching it).
        return grouped.map((f) => {
          const detail = f.next_action || f.current_stage;
          return {
            label: f.feature_name || f.id,
            description: detail ? `${f.title} — ${detail}` : f.title,
            group: f.status,
          };
        });
      }

      return [
        {
          label: 'Feature tags',
          description: 'Not available yet — connect and select a workspace first.',
        },
      ];
    }

    case '/': {
      // Real tool registry (GET /tools — no auth/workspace scoping on the
      // endpoint itself, just a valid token), mirrors digital-factory-ui's
      // SlashCommandPicker exactly: tool_name -> "/tool-name". Shows every
      // available command when the query is still empty (bare "/") —
      // matching Slack/Discord-style pickers — then narrows as the user
      // types, same as the other three trigger kinds.
      const tools = await listTools(codingApiConfig(codingApiCtx));
      const q = query.toLowerCase();
      return (tools ?? [])
        .map((t) => ({ slashName: t.name.replace(/_/g, '-'), description: t.description }))
        .filter((c) => c.slashName.includes(q))
        .sort((a, b) => a.slashName.localeCompare(b.slashName))
        .map((c) => ({
          label: `/${c.slashName}`,
          description: c.description,
          insertValue: c.slashName,
        }));
    }

    default:
      return [];
  }
}
