import * as fs from 'fs/promises';
import * as path from 'path';

const REPO_LINKS_RELATIVE_PATH = path.join('.actorium', 'repo-links.json');

interface RepoLinksFile {
  version: 1;
  description: string;
  links: Record<string, string>;
}

const DESCRIPTION =
  'Maps each locally-linked repo folder (a symlink directly inside this workspace folder)';

export async function readRepoLinkManifest(folderPath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(folderPath, REPO_LINKS_RELATIVE_PATH), 'utf8');
    const parsed = JSON.parse(raw) as Partial<RepoLinksFile>;
    return parsed.links && typeof parsed.links === 'object' ? parsed.links : {};
  } catch {
    return {};
  }
}

async function writeRepoLinkManifest(
  folderPath: string,
  links: Record<string, string>,
): Promise<void> {
  const filePath = path.join(folderPath, REPO_LINKS_RELATIVE_PATH);
  const file: RepoLinksFile = { version: 1, description: DESCRIPTION, links };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

/**
 * Records that `linkName` (the actual local symlink folder name) is an
 * exact link to `repoId` — called after every successful link/clone where
 * the corresponding workflow-backend repo is known, even when linkName
 * already equals repoId (keeps the manifest authoritative for every repo
 * it's ever recorded, rather than mixing "explicit" and "assumed" entries).
 */
export async function setRepoLink(
  folderPath: string,
  linkName: string,
  repoId: string,
): Promise<void> {
  const links = await readRepoLinkManifest(folderPath);
  links[linkName] = repoId;
  await writeRepoLinkManifest(folderPath, links);
}

export async function removeRepoLink(folderPath: string, linkName: string): Promise<void> {
  const links = await readRepoLinkManifest(folderPath);
  if (!(linkName in links)) return;
  delete links[linkName];
  await writeRepoLinkManifest(folderPath, links);
}

/**
 * Rebuilds repo-links.json from actual current state — the Navigator
 * webview's "Repair" action. Keeps any existing mapping still valid (its
 * repo id is still tracked by the workspace, or the workspace repo list is
 * unavailable to validate against), drops entries for repos no longer
 * linked on disk, and fills in an exact-name match for any linked repo
 * that's missing a mapping. Never invents a mapping it can't justify by an
 * exact name match — an ambiguous rename needs a human pick via addRepo's
 * "Which workspace repo is X?" picker, not a guess.
 */
export async function repairRepoLinkManifest(
  folderPath: string,
  linkedNames: string[],
  workspaceRepoIds: string[],
): Promise<void> {
  const existing = await readRepoLinkManifest(folderPath);
  const repaired: Record<string, string> = {};

  for (const name of linkedNames) {
    const current = existing[name];
    const currentStillValid =
      current !== undefined &&
      (workspaceRepoIds.length === 0 ||
        workspaceRepoIds.some((id) => id.toLowerCase() === current.toLowerCase()));
    if (currentStillValid) {
      repaired[name] = current;
      continue;
    }
    const exact = workspaceRepoIds.find((id) => id.toLowerCase() === name.toLowerCase());
    if (exact) repaired[name] = exact;
  }

  await writeRepoLinkManifest(folderPath, repaired);
}
