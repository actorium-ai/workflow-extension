import * as fs from 'fs/promises';
import * as vscode from 'vscode';

/**
 * Exposes the bundled shared workflow rules (`resources/shared.md`) for
 * `agentsFile.ts` to embed directly into AGENTS.md's generated section —
 * there's no separate `shared.md` file written to the workspace folder;
 * embedding is the only delivery path, so it can't be skipped the way a
 * sibling file could.
 *
 * The process skills this module used to also install from
 * `resources/workflow_skills/*` into `.claude/skills/` are gone — a
 * bundled, Docker-baked copy would just drift from the real content.
 * `review-pr` and `respond-to-review` are already platform skills in
 * workflow-backend's registry and sync the same way `technicalSkills.ts`
 * syncs the rest; `resume-feature` has no registry equivalent yet.
 */

function bundledSharedRulesPath(context: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(context.extensionUri, 'resources', 'shared.md').fsPath;
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
