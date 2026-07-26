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
description: Find a local git clone by name and symlink it into this Actorium workspace folder, then update AGENTS.md's linked-repo list. Use whenever a repo referenced in AGENTS.md (or asked for by name) isn't yet a subfolder here.
---

# link-repo

Links a local git repository into this workspace folder as a symlink — the same outcome as
the VS Code extension's "Actorium: Add Repo" command, but done here via your own Bash/Read/Edit
tools so it works headlessly (no VS Code UI involved).

## When to use this

- AGENTS.md's "Linked repos" list is missing a repo you need to work on.
- You've been asked to add/link a repo by name (e.g. \`/link-repo workflow-mcp\`).
- A task references a repo path that doesn't exist yet under this workspace folder.

## Steps

1. **Find the workspace root.** Starting from the current directory, walk upward until you find
   an \`AGENTS.md\` containing the marker \`<!-- actorium:generated:start -->\`. That directory is
   the workspace root — every repo lives directly inside it as a symlink. If no such file exists
   anywhere above you, stop and tell the user this doesn't look like an Actorium workspace folder.

2. **Check what's already linked.** Run \`ls -la <workspace-root>\` and look for symlinks
   (entries starting with \`l\` in \`ls -la\`'s permission column). If the requested repo is already
   linked, say so and stop — don't re-link or overwrite it without being asked to.

3. **Search for a local clone.** Look for a directory (anywhere reasonable, not just one fixed
   path) whose name matches the repo (case-insensitive, allow a repo slug like \`workflow-mcp\`
   to match a folder named the same) AND contains a \`.git\` entry. Good places to check, in
   order, stopping once you have a confident match:
   - Common code roots: \`~/code\`, \`~/dev\`, \`~/projects\`, \`~/src\`, and the workspace root's own
     parent directory (repos are often siblings of the workspace folder).
   - A shallow \`find <root> -maxdepth 2 -type d -iname '<repo-name>*'\` per root, then confirm
     each hit has a \`.git\` entry before treating it as a candidate.
   Do not descend into a directory once it's confirmed to be a git repo (skip its subdirectories)
   — nested vendored/submodule folders that happen to match the name are noise, not candidates.

4. **Resolve to exactly one candidate:**
   - **Zero matches** — tell the user you couldn't find a local clone, and ask them to either
     clone it somewhere first or give you the exact path to link.
   - **Exactly one match** — proceed to link it (step 5).
   - **More than one match** — list every candidate's full path and ask the user which one to
     use. Never guess silently when there's ambiguity.

5. **Create the symlink.** Run:
   \`\`\`sh
   ln -s "<candidate-path>" "<workspace-root>/<repo-name>"
   \`\`\`
   Use the repo's own directory name as \`<repo-name>\` unless the user asked for a different link
   name. Verify with \`ls -la <workspace-root>/<repo-name>\` that the symlink was created and
   resolves correctly.

6. **Update AGENTS.md.** Open \`<workspace-root>/AGENTS.md\` and find the region between
   \`<!-- actorium:generated:start -->\` and \`<!-- actorium:generated:end -->\`. Inside it, under
   the "## Linked repos" heading, add a new bullet in the existing format:
   \`- \\\`<repo-name>/\\\` → <candidate-path>\`
   (replacing the "_No repos linked yet…_" placeholder line if that's still there). Leave
   everything else in the file — including anything outside those two markers — untouched.

7. **Confirm.** Tell the user the repo is linked and where it points, and that AGENTS.md now
   lists it.

## Safety

- Never overwrite an existing file or symlink at the target path without explicit confirmation.
- Never delete or move the source repo — this only ever creates a symlink pointing at it.
- If anything about steps 1–4 is ambiguous (workspace root not found, multiple candidates,
  unclear repo name), stop and ask rather than guessing.
`;

export async function writeLinkRepoSkill(folderPath: string): Promise<void> {
  const skillDir = path.join(folderPath, '.claude', 'skills', 'link-repo');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), SKILL_MD, 'utf8');
}
