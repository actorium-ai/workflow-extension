import * as fs from 'fs/promises';
import * as path from 'path';

export interface WorkspaceManifest {
  workspaceId: string;
  orgId: string;
}

const MANIFEST_RELATIVE_PATH = path.join('.actorium', 'workspace.json');

/**
 * Writes a small machine-readable manifest at `<folderPath>/.actorium/workspace.json`
 * identifying which Actorium workspace this folder belongs to. actorium-mcp reads
 * this (walking upward from its own cwd — see its own src/workspaceManifest.ts,
 * which must stay in sync with this exact relative path/shape) to resolve which
 * workspace it's running for directly from the folder it's in, rather than
 * trusting the shared credential file's single "last selected" value — which,
 * with multiple VS Code windows open on different workspaces, only reflects
 * whichever window most recently synced it.
 */
export async function writeWorkspaceManifest(
  folderPath: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  const manifestPath = path.join(folderPath, MANIFEST_RELATIVE_PATH);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
