import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Installs the bundled process skills (`resources/workflow_skills/*`, e.g.
 * `start-implementation`, `tech-lead`, `approve-feature`) into the workspace
 * folder's `.claude/skills/`, and exposes the bundled shared workflow rules
 * (`resources/shared.md`) for `agentsFile.ts` to embed directly into
 * AGENTS.md's generated section — there's no separate `shared.md` file
 * written to the workspace folder; embedding is the only delivery path, so
 * it can't be skipped the way a sibling file could.
 *
 * Unlike `technicalSkills.ts`'s bundle (per-task, opt-in, user-toggled via
 * the Skills UI), the workflow skills are the baseline set every agent needs
 * the moment it opens a linked workspace folder — same "always installed,
 * unconditionally regenerated" precedent as `skillFile.ts`'s
 * `writeLinkRepoSkill` and `agentsFile.ts`'s `writeAgentsFile`. Called
 * alongside those from `regenerateAgentsFile` in extension.ts.
 *
 * Claude-only destination (`.claude/skills/`), matching `writeLinkRepoSkill`
 * — agents that don't support Skills still get the rules via AGENTS.md.
 */

function bundledSharedRulesPath(context: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(context.extensionUri, 'resources', 'shared.md').fsPath;
}

function bundledWorkflowSkillsDir(context: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(context.extensionUri, 'resources', 'workflow_skills').fsPath;
}

/**
 * Reads the bundled `shared.md` content so `agentsFile.ts` can embed it
 * directly in AGENTS.md's generated section. Returns null if the bundled
 * file is missing from this build.
 */
export async function readBundledSharedRules(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  try {
    return await fs.readFile(bundledSharedRulesPath(context), 'utf8');
  } catch {
    return null;
  }
}

export async function writeWorkflowRules(
  context: vscode.ExtensionContext,
  folderPath: string,
): Promise<void> {
  const src = bundledWorkflowSkillsDir(context);
  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch {
    return; // Bundled directory missing from this build — nothing to install.
  }

  const dest = path.join(folderPath, '.claude', 'skills');
  await fs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await fs.cp(path.join(src, entry.name), path.join(dest, entry.name), {
      recursive: true,
      force: true,
    });
  }
}
