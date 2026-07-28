import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

const START_MARKER = '<!-- actorium:generated:start -->';
const END_MARKER = '<!-- actorium:generated:end -->';
const WORKSPACE_RULES_HEADING = '## Workspace custom rules';

export interface AgentsFileParams {
  orgName: string;
  workspaceName: string;
  workspaceId: string;
}

/**
 * Shifts every Markdown heading in `md` down one level (`#` -> `##`,
 * `##` -> `###`, etc.) so `shared.md`'s own top-level `# Shared workflow
 * rules` title nests correctly as a subsection once spliced into AGENTS.md's
 * generated section, rather than competing with it at the same heading
 * depth. Only matches headings at the start of a line (the standard ATX
 * form this repo's docs use) — a `#` appearing mid-line (e.g. inside a code
 * fence) is left untouched.
 */
function shiftHeadingsDown(md: string): string {
  return md.replace(/^(#+)(\s)/gm, '#$1$2');
}

function generatedSection(params: AgentsFileParams, sharedRulesMarkdown: string | null): string {
  const sharedRulesSection = sharedRulesMarkdown
    ? shiftHeadingsDown(sharedRulesMarkdown.trimEnd())
    : `## Shared workflow rules

\`shared.md\` wasn't found in this extension build — check
\`packages/vscode/resources/shared.md\` exists, then reinstall/rebuild the
extension. Do not proceed on feature/task work without it.`;

  return `${START_MARKER}
# Actorium workspace: ${params.workspaceName} (${params.orgName})

This folder is an **Actorium workspace** — a container for the repos belonging to
the "${params.workspaceName}" workspace (id \`${params.workspaceId}\`). Each subfolder
directly inside it is a symlink to a real local git clone; edit/commit/push in them
exactly as you would any other checkout.

## Linked repos

See \`.actorium/repo-links.json\` for the exact mapping from each linked folder name
to its Actorium repo id — a folder's name doesn't always match its repo id (e.g. a
clone named \`engine-ui\` linked as the \`engine-dashboard\` repo), so don't assume the
two are the same; that file is the source of truth.

Missing a repo you need? Run "Actorium: Add Repo" in VS Code to link it in.

## Before you do anything

The **Shared workflow rules** section below (embedded directly from \`shared.md\` —
there's no separate copy of that file in this folder) governs every feature/task-scoped
change you make here — feature/task lifecycle, review boundaries, PR conventions,
and the **Context-gathering pre-flight** rule. Read it before editing anything;
do not skip straight to code.

At minimum, before acting on any feature or task: resolve the workspace, resolve
the feature (\`get_feature\`), resolve the task (\`get_task\`), query RAG, query
GitNexus, and read the feature's \`product_spec\`/\`technical_design\`/\`tasks\`
documents if you're working inside a feature.

If \`.claude/skills/\` has skills beyond \`link-repo\` (e.g. \`start-implementation\`,
\`tech-lead\`, \`approve-feature\`), those are this workspace's process skills —
prefer them over improvising the same steps from scratch.

${sharedRulesSection}

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
 * Appends a pointer to `WORKSPACE-RULES.md` right after the generated
 * section, once, the first time AGENTS.md is written for a workspace folder
 * — `ensureWorkspaceRulesFile` (see workspaceRulesFile.ts) creates that file
 * alongside it. Skipped on every later regeneration once the heading is
 * already present, since content after the end marker is never touched by
 * the marker-replace path above and would otherwise need re-adding.
 */
function withWorkspaceRulesPointer(content: string): string {
  if (content.includes(WORKSPACE_RULES_HEADING)) return content;
  const pointer = `${WORKSPACE_RULES_HEADING}

See \`WORKSPACE-RULES.md\` in this folder for workspace-specific rules that
supplement or override the shared rules above. That file is user-owned —
this extension never generates or overwrites it.
`;
  return `${content.trimEnd()}\n\n${pointer}`;
}

/**
 * Writes/updates AGENTS.md at the workspace folder's root, guiding any
 * AGENTS.md-aware coding agent (Claude Code, etc.) opened there. Only the
 * region between the start/end markers is regenerated — content a user
 * added above or below the markers survives untouched, so hand-written
 * notes aren't clobbered by a later "Add repo" regeneration.
 *
 * `sharedRulesMarkdown` (from `workflowRules.ts`'s `readBundledSharedRules`)
 * is embedded directly in the generated section, not just linked to — a
 * separate file is easy to skip, but every agent reads AGENTS.md. Pass null
 * if the bundled `shared.md` couldn't be read; a fallback notice is embedded
 * instead of silently omitting the rules.
 */
export async function writeAgentsFile(
  folderPath: string,
  params: AgentsFileParams,
  sharedRulesMarkdown: string | null,
): Promise<void> {
  const filePath = path.join(folderPath, 'AGENTS.md');
  const section = generatedSection(params, sharedRulesMarkdown);

  let existing = '';
  if (fsSync.existsSync(filePath)) {
    existing = await fs.readFile(filePath, 'utf8');
  }

  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  const next = withWorkspaceRulesPointer(
    startIdx !== -1 && endIdx !== -1 && endIdx > startIdx
      ? existing.slice(0, startIdx) + section + existing.slice(endIdx + END_MARKER.length)
      : existing
        ? `${existing.trimEnd()}\n\n${section}\n`
        : `${section}\n`,
  );

  await fs.writeFile(filePath, next, 'utf8');
}
