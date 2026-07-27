import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AgentTarget } from './mcpConnect.js';

export interface TechnicalSkillsStatus {
  /** True only once every bundled skill has a matching SKILL.md under this
   * workspace folder's target skills directory — a partial install (some
   * but not all copied) still reports false, since "Install" always
   * re-copies the full set anyway. */
  installed: boolean;
  total: number;
}

/** Each agent's own skills directory convention, relative to the workspace
 * folder — same three targets mcpConnect.ts registers actorium-mcp with. */
const SKILLS_DEST_RELATIVE: Record<AgentTarget, [string, string]> = {
  claude: ['.claude', 'skills'],
  codex: ['.codex', 'skills'],
  opencode: ['.opencode', 'skills'],
};

/** resources/technical_skills is committed directly in this package (curated
 * SKILL.md folders — plain data, not something esbuild bundles). Shared
 * across all three targets: the skill content itself doesn't differ, only
 * where each agent looks for it. */
function bundledSkillsDir(context: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(context.extensionUri, 'resources', 'technical_skills').fsPath;
}

/** Every top-level bundled folder, regardless of what's inside — what
 * install/uninstall copy or remove wholesale. */
async function bundledEntryNames(context: vscode.ExtensionContext): Promise<string[]> {
  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(bundledSkillsDir(context), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/** Just the entries that are actual Claude Skills (their own SKILL.md at
 * the bundle root) — what "installed" status is measured against. A
 * top-level folder without one (e.g. a grouping folder whose real skills
 * are still-empty placeholder subfolders) would otherwise permanently
 * block every target's status from ever reading "installed", since the
 * whole-set check requires every entry to have a matching SKILL.md. */
async function bundledSkillNames(context: vscode.ExtensionContext): Promise<string[]> {
  const dir = bundledSkillsDir(context);
  const entries = await bundledEntryNames(context);
  const withSkillMd = await Promise.all(
    entries.map((name) =>
      fs.access(path.join(dir, name, 'SKILL.md')).then(
        () => name,
        () => null,
      ),
    ),
  );
  return withSkillMd.filter((name): name is string => name !== null);
}

function workspaceSkillsDir(workspaceFolderPath: string, target: AgentTarget): string {
  return path.join(workspaceFolderPath, ...SKILLS_DEST_RELATIVE[target]);
}

/**
 * Checks how many of the bundled Claude Technical Skills are already copied
 * into this workspace folder's target skills directory — driving the
 * Plugins section's "<Agent> Technical Skills" row (Install vs.
 * already-installed) for whichever of claude/codex/opencode was asked for.
 */
export async function getTechnicalSkillsStatus(
  context: vscode.ExtensionContext,
  workspaceFolderPath: string,
  target: AgentTarget,
): Promise<TechnicalSkillsStatus> {
  const names = await bundledSkillNames(context);
  if (names.length === 0) return { installed: false, total: 0 };

  const dest = workspaceSkillsDir(workspaceFolderPath, target);
  const present = await Promise.all(
    names.map((name) =>
      fs.access(path.join(dest, name, 'SKILL.md')).then(
        () => true,
        () => false,
      ),
    ),
  );
  return { installed: present.every(Boolean), total: names.length };
}

/**
 * Copies every bundled Claude Technical Skill into this workspace folder's
 * target skills directory, overwriting whatever's already there — same
 * "always fully regenerate" precedent as skillFile.ts's writeLinkRepoSkill,
 * since these are curated skills a user isn't expected to hand-edit in
 * place.
 */
export async function installTechnicalSkills(
  context: vscode.ExtensionContext,
  workspaceFolderPath: string,
  target: AgentTarget,
): Promise<{ ok: boolean; message: string }> {
  const src = bundledSkillsDir(context);
  const names = await bundledEntryNames(context);
  if (names.length === 0) {
    return { ok: false, message: 'No bundled technical skills found in this extension build.' };
  }

  const dest = workspaceSkillsDir(workspaceFolderPath, target);
  await fs.mkdir(dest, { recursive: true });
  for (const name of names) {
    await fs.cp(path.join(src, name), path.join(dest, name), { recursive: true, force: true });
  }

  const destRelative = path.join(...SKILLS_DEST_RELATIVE[target]);
  return {
    ok: true,
    message: `Installed ${names.length} technical skill${names.length === 1 ? '' : 's'} to ${destRelative}.`,
  };
}

/**
 * Removes every bundled Claude Technical Skill's folder from this workspace
 * folder's target skills directory — only the folders matching a bundled
 * skill name, so an unrelated skill the user placed in the same directory
 * (a custom one, or one from a different source) is left untouched.
 */
export async function uninstallTechnicalSkills(
  context: vscode.ExtensionContext,
  workspaceFolderPath: string,
  target: AgentTarget,
): Promise<{ ok: boolean; message: string }> {
  const names = await bundledEntryNames(context);
  if (names.length === 0) {
    return { ok: false, message: 'No bundled technical skills found in this extension build.' };
  }

  const dest = workspaceSkillsDir(workspaceFolderPath, target);
  for (const name of names) {
    await fs.rm(path.join(dest, name), { recursive: true, force: true });
  }

  const destRelative = path.join(...SKILLS_DEST_RELATIVE[target]);
  return {
    ok: true,
    message: `Removed ${names.length} technical skill${names.length === 1 ? '' : 's'} from ${destRelative}.`,
  };
}
