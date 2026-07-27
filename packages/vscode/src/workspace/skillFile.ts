import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Claude Code Skill (https://docs.claude.com/en/docs/claude-code/skills) that
 * teaches an agent to do what "Actorium: Add Repo" does interactively (see
 * repoLinker.ts), but headlessly — searching local paths for a matching git
 * clone and symlinking it in, with no VS Code QuickPick involved. Written
 * into the workspace folder itself (not baked into this extension's own
 * repo) so it travels with the workspace and is available the moment a user
 * opens that folder in Claude Code — agents that don't support Skills can
 * still follow the same steps via AGENTS.md's pointer to this file.
 *
 * Kept as one static template (no per-workspace customization) — always
 * fully overwritten on regenerate, unlike AGENTS.md's marker-scoped merge,
 * since there's no expectation a user hand-edits a generated skill file.
 */
const SKILL_MD = `---
name: link-repo
description: Find a local git clone by name and symlink it into this Actorium workspace folder, then record the exact mapping in .actorium/repo-links.json. Use whenever a repo mentioned by name isn't yet a subfolder here.
---

# link-repo

Links a local git repository into this workspace folder as a symlink — the same outcome as
the VS Code extension's "Actorium: Add Repo" / "Clone from git" actions, but done here via your
own Bash/Read/Edit tools so it works headlessly (no VS Code UI involved).

## When to use this

- You've been asked to add/link a repo by name (e.g. \`/link-repo workflow-mcp\`).
- A task references a repo path that doesn't exist yet under this workspace folder.

## Steps

1. **Find the workspace root.** Starting from the current directory, walk upward until you find
   an \`AGENTS.md\` containing the marker \`<!-- actorium:generated:start -->\`. That directory is
   the workspace root — every repo lives directly inside it as a symlink. If no such file exists
   anywhere above you, stop and tell the user this doesn't look like an Actorium workspace folder.

2. **Check what's already linked.** Run \`ls -la <workspace-root>\` and look for symlinks
   (entries starting with \`l\` in \`ls -la\`'s permission column) — cross-reference against
   \`<workspace-root>/.actorium/repo-links.json\` if it exists (its \`links\` object maps each
   symlink's folder name to its real repo id, which may differ from the folder name — see step
   6). If the requested repo is already linked, say so and stop — don't re-link or overwrite it
   without being asked to.

3. **Resolve the exact repo id.** Call actorium-mcp's \`list_workspace_repos()\` tool to get this
   workspace's authoritative list of repo ids. If the name you were given matches one exactly
   (case-insensitive), that's the repo id. If it doesn't match any of them, or matches more than
   one ambiguously, list the candidates and ask the user which repo id this is — never guess.
   This id is what goes in \`.actorium/repo-links.json\` in step 6, regardless of what the local
   clone's folder happens to be named.

4. **Search for a local clone.** Look for a directory (anywhere reasonable, not just one fixed
   path) whose name matches the repo (case-insensitive; the folder name doesn't have to match the
   repo id resolved in step 3 — e.g. a repo id \`engine-dashboard\` might live in a folder named
   \`engine-ui\`) AND contains a \`.git\` entry. Good places to check, in order, stopping once you
   have a confident match:
   - Common code roots: \`~/code\`, \`~/dev\`, \`~/projects\`, \`~/src\`, and the workspace root's own
     parent directory (repos are often siblings of the workspace folder).
   - A shallow \`find <root> -maxdepth 2 -type d -iname '<repo-name>*'\` per root, then confirm
     each hit has a \`.git\` entry before treating it as a candidate.
   Do not descend into a directory once it's confirmed to be a git repo (skip its subdirectories)
   — nested vendored/submodule folders that happen to match the name are noise, not candidates.

   **Resolve to exactly one candidate:**
   - **Zero matches** — tell the user you couldn't find a local clone, and ask them to either
     clone it somewhere first or give you the exact path to link.
   - **Exactly one match** — proceed to link it (step 5).
   - **More than one match** — list every candidate's full path and ask the user which one to
     use. Never guess silently when there's ambiguity.

5. **Create the symlink.** Run:
   \`\`\`sh
   ln -s "<candidate-path>" "<workspace-root>/<link-name>"
   \`\`\`
   Use the local clone's own directory name as \`<link-name>\` unless the user asked for a
   different one. Verify with \`ls -la <workspace-root>/<link-name>\` that the symlink was created
   and resolves correctly.

6. **Record the mapping in .actorium/repo-links.json.** Read
   \`<workspace-root>/.actorium/repo-links.json\` if it exists (JSON:
   \`{"version": 1, "description": "...", "links": {"<link-name>": "<repo-id>"}}\`); if it doesn't,
   start from \`{"version": 1, "description": "Maps each locally-linked repo folder (a symlink
   directly inside this workspace folder) to its exact Actorium repo id.", "links": {}}\`. Set
   \`links["<link-name>"]\` (the symlink name from step 5) to the repo id resolved in step 3 — even
   when they're the same string, so the file stays authoritative for this repo either way. Write
   it back as valid, 2-space-indented JSON. This file — not AGENTS.md — is the source of truth an
   agent should read to know which folder is which repo; AGENTS.md only points here.

7. **Confirm.** Tell the user the repo is linked, where it points, and that
   \`.actorium/repo-links.json\` now maps \`<link-name>\` → \`<repo-id>\`.

## Safety

- Never overwrite an existing file or symlink at the target path without explicit confirmation.
- Never delete or move the source repo — this only ever creates a symlink pointing at it.
- If anything about steps 1–4 is ambiguous (workspace root not found, multiple candidates,
  unclear repo id), stop and ask rather than guessing.
`;

export async function writeLinkRepoSkill(folderPath: string): Promise<void> {
  const skillDir = path.join(folderPath, '.claude', 'skills', 'link-repo');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), SKILL_MD, 'utf8');
}
