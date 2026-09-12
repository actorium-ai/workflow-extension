import type { ApiSuccessResponse } from '@workflow-extension/shared';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { CodingApiConfig } from '../navigator/workflow-api.js';
import type { AgentTarget } from './mcpConnect.js';

export interface TechnicalSkillsStatus {
  /** True only once every skill this workspace resolves for this target
   * already has a matching SKILL.md under the target's skills directory —
   * a partial install (some but not all synced) still reports false, since
   * "Install" always re-syncs the full set anyway. */
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

function workspaceSkillsDir(workspaceFolderPath: string, target: AgentTarget): string {
  return path.join(workspaceFolderPath, ...SKILLS_DEST_RELATIVE[target]);
}

// ─── workflow-backend skills-registry response shapes (only the fields
// this module reads) — see workflow-backend's internal/domain.Skill /
// SkillVersion / SkillManifest / SkillCandidate. ──────────────────────────

interface SkillManifestDto {
  requires?: string[];
  executors?: string[];
}

interface SkillDto {
  slug: string;
  active: boolean;
  latest_version_id: string | null;
}

interface SkillVersionDto {
  id: string;
  manifest: SkillManifestDto;
}

interface SkillCandidateDto {
  skill: SkillDto;
  latest_version: SkillVersionDto;
  enabled: boolean;
}

interface SkillCandidatesResponse {
  candidates: SkillCandidateDto[];
}

/** Mirrors workflow-backend's ResolveEffectiveSkills executor filter: an
 * empty `executors` list means "valid for every executor". No `requires:`
 * (MCP-capability) filtering here — unlike an executor container, this
 * extension has no reliable signal for which MCP tools the user's local CLI
 * session has registered, so a capability-gated skill (e.g. figma-mcp)
 * still syncs; its own SKILL.md already tells the agent to check for the
 * tool before using it. */
function isCompatible(manifest: SkillManifestDto, target: AgentTarget): boolean {
  const executors = manifest.executors ?? [];
  return executors.length === 0 || executors.includes(target);
}

async function authedJson<T>(config: CodingApiConfig, url: string): Promise<T | null> {
  const token = await config.getToken();
  if (!token) return null;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  try {
    const body = (await resp.json()) as ApiSuccessResponse<T>;
    return body.data;
  } catch {
    return null;
  }
}

/** GET /api/workspaces/{workspaceId}/skill-policies/candidates — the SAME
 * endpoint the web app's Skill policies page reads — reduced to the
 * (slug, versionId) pairs this workspace actually resolves for `target`. */
async function resolveWorkspaceSkills(
  config: CodingApiConfig,
  workspaceId: string,
  target: AgentTarget,
): Promise<{ slug: string; versionId: string }[]> {
  const data = await authedJson<SkillCandidatesResponse>(
    config,
    `${config.workflowBackendUrl}/api/workspaces/${workspaceId}/skill-policies/candidates`,
  );
  if (!data) return [];
  return data.candidates
    .filter(
      (c) =>
        c.enabled &&
        c.skill.active &&
        c.skill.latest_version_id &&
        isCompatible(c.latest_version.manifest, target),
    )
    .map((c) => ({ slug: c.skill.slug, versionId: c.latest_version.id }));
}

/** GET /api/skills/versions/{versionId}/files — a skill version's full
 * bundle file map (the SAME endpoint the admin Skills page's editor
 * reads), or null on any fetch/parse failure. */
async function fetchSkillFiles(
  config: CodingApiConfig,
  versionId: string,
): Promise<Record<string, string> | null> {
  const data = await authedJson<{ files: Record<string, string> }>(
    config,
    `${config.workflowBackendUrl}/api/skills/versions/${encodeURIComponent(versionId)}/files`,
  );
  return data?.files ?? null;
}

async function hasSkillMd(dir: string): Promise<boolean> {
  return fs.access(path.join(dir, 'SKILL.md')).then(
    () => true,
    () => false,
  );
}

/**
 * Checks how many of this workspace's resolved skills (for `target`) are
 * already synced into this workspace folder's target skills directory —
 * driving the Plugins section's "<Agent> Technical Skills" row (Install vs.
 * already-installed).
 */
export async function getTechnicalSkillsStatus(
  config: CodingApiConfig,
  workspaceId: string,
  workspaceFolderPath: string,
  target: AgentTarget,
): Promise<TechnicalSkillsStatus> {
  const skills = await resolveWorkspaceSkills(config, workspaceId, target);
  if (skills.length === 0) return { installed: false, total: 0 };

  const dest = workspaceSkillsDir(workspaceFolderPath, target);
  const present = await Promise.all(skills.map((s) => hasSkillMd(path.join(dest, s.slug))));
  return { installed: present.every(Boolean), total: skills.length };
}

/**
 * Fetches every skill this workspace resolves for `target` from
 * workflow-backend's skills registry and writes each one's bundle into this
 * workspace folder's target skills directory, overwriting whatever's
 * already there for that slug — same "always fully regenerate" precedent
 * as skillFile.ts's writeLinkRepoSkill, since these are registry-curated
 * skills a user isn't expected to hand-edit in place. A skill whose bundle
 * fetch fails is skipped rather than aborting the rest.
 */
export async function installTechnicalSkills(
  config: CodingApiConfig,
  workspaceId: string,
  workspaceFolderPath: string,
  target: AgentTarget,
): Promise<{ ok: boolean; message: string }> {
  const skills = await resolveWorkspaceSkills(config, workspaceId, target);
  if (skills.length === 0) {
    return {
      ok: false,
      message:
        'No skills are enabled for this workspace, or the skills registry could not be reached.',
    };
  }

  const dest = workspaceSkillsDir(workspaceFolderPath, target);
  await fs.mkdir(dest, { recursive: true });

  let installed = 0;
  for (const { slug, versionId } of skills) {
    const files = await fetchSkillFiles(config, versionId);
    if (!files) continue;
    const skillDir = path.join(dest, slug);
    await fs.rm(skillDir, { recursive: true, force: true });
    for (const [relPath, content] of Object.entries(files)) {
      const filePath = path.join(skillDir, relPath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
    }
    installed++;
  }

  const destRelative = path.join(...SKILLS_DEST_RELATIVE[target]);
  if (installed === 0) {
    return {
      ok: false,
      message: `Found ${skills.length} skill(s) but could not fetch any of their content from the registry.`,
    };
  }
  return {
    ok: true,
    message: `Synced ${installed} of ${skills.length} skill${skills.length === 1 ? '' : 's'} to ${destRelative}.`,
  };
}

/**
 * Removes every skill folder (any top-level directory with its own
 * SKILL.md) from this workspace folder's target skills directory — reads
 * the directory itself rather than re-resolving the registry, so it works
 * even when offline and never leaves an orphaned skill behind if the
 * workspace's enabled set changed since the last install.
 */
export async function uninstallTechnicalSkills(
  workspaceFolderPath: string,
  target: AgentTarget,
): Promise<{ ok: boolean; message: string }> {
  const dest = workspaceSkillsDir(workspaceFolderPath, target);
  let entries;
  try {
    entries = await fs.readdir(dest, { withFileTypes: true });
  } catch {
    return { ok: false, message: 'No synced technical skills found in this workspace folder.' };
  }

  const skillDirs = (
    await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => ({ name: e.name, isSkill: await hasSkillMd(path.join(dest, e.name)) })),
    )
  ).filter((e) => e.isSkill);

  for (const { name } of skillDirs) {
    await fs.rm(path.join(dest, name), { recursive: true, force: true });
  }

  const destRelative = path.join(...SKILLS_DEST_RELATIVE[target]);
  return {
    ok: true,
    message: `Removed ${skillDirs.length} technical skill${skillDirs.length === 1 ? '' : 's'} from ${destRelative}.`,
  };
}
