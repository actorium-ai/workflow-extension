import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { LinkedRepo } from './repoLinker.js';

const START_MARKER = '<!-- actorium:generated:start -->';
const END_MARKER = '<!-- actorium:generated:end -->';

export interface AgentsFileParams {
  orgName: string;
  workspaceName: string;
  workspaceId: string;
  linkedRepos: LinkedRepo[];
}

function generatedSection(params: AgentsFileParams): string {
  const repoLines = params.linkedRepos.length
    ? params.linkedRepos.map((r) => `- \`${r.name}/\` → ${r.target}`).join('\n')
    : '_No repos linked yet — run "Actorium: Add Repo" in VS Code._';

  return `${START_MARKER}
# Actorium workspace: ${params.workspaceName} (${params.orgName})

This folder is an **Actorium workspace** — a container for the repos belonging to
the "${params.workspaceName}" workspace (id \`${params.workspaceId}\`). Each subfolder
below is a symlink to a real local git clone; edit/commit/push in them exactly as
you would any other checkout.

## Linked repos

${repoLines}

Missing a repo you need? Run "Actorium: Add Repo" in VS Code to link it in.

## actorium-mcp

This workspace's feature/task/doc/PR context lives in \`actorium-mcp\`'s tools, not in git.
It's **read-only** — no tool here mutates anything, so it's always safe to call.

- \`get_feature({ name })\` — resolve a feature slug to full detail: status/stage, documents,
  tasks, activity timeline, sync state.
- \`search_features({ status?, title?, include_tasks? })\` / \`search_tasks({ feature_id?, status?, repo? })\`
  — list/filter features or tasks.
- \`get_task({ task_id })\` — full task detail: execution info, both PR refs, activity, deps.
- \`get_task_diff({ task_id, repo? })\` / \`get_task_review_thread({ task_id, repo? })\`
  — a task's PR file list + diff, or its reviews/comments merged chronologically.
- \`get_feature_handoff({ feature_id })\` — a go-owned feature's multi-repo handoff state.
- \`list_workspace_activity({ feature_id?, task_id?, audience? })\` — the audit/activity feed.
- \`list_workspace_repos()\` — every repo registered in this workspace.
- \`read_storage_document({ feature_id, kind })\` — a go-owned feature's product_spec /
  technical_design / tasks / handoff doc content.
- \`list_workspace_documents({ feature_id? })\` / \`get_document_versions({ document_id })\`
  — document metadata / edit history (no content — use \`read_storage_document\` for that).
- \`whoami()\` — the authenticated caller's identity, org memberships, and roles.
- \`list_workspaces({ org_id? })\` — every workspace in an organization.

\`workspace_id\` can be omitted from every call above — it defaults to this
workspace (\`${params.workspaceId}\`) via the Actorium VS Code extension's shared
credential file. Pass it explicitly only to target a different workspace.

If a needed capability doesn't exist yet, workflow-mcp (the sibling project that ships
\`actorium-mcp\`) is a small, focused server — see its own AGENTS.md/README for how its
tools are implemented and tested.
${END_MARKER}`;
}

/**
 * Writes/updates AGENTS.md at the workspace folder's root, guiding any
 * AGENTS.md-aware coding agent (Claude Code, etc.) opened there. Only the
 * region between the start/end markers is regenerated — content a user
 * added above or below the markers survives untouched, so hand-written
 * notes aren't clobbered by a later "Add repo" regeneration.
 */
export async function writeAgentsFile(folderPath: string, params: AgentsFileParams): Promise<void> {
  const filePath = path.join(folderPath, 'AGENTS.md');
  const section = generatedSection(params);

  let existing = '';
  if (fsSync.existsSync(filePath)) {
    existing = await fs.readFile(filePath, 'utf8');
  }

  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  const next =
    startIdx !== -1 && endIdx !== -1 && endIdx > startIdx
      ? existing.slice(0, startIdx) + section + existing.slice(endIdx + END_MARKER.length)
      : existing
        ? `${existing.trimEnd()}\n\n${section}\n`
        : `${section}\n`;

  await fs.writeFile(filePath, next, 'utf8');
}
