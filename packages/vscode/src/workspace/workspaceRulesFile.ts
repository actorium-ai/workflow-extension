import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEMPLATE = `# Workspace custom rules

Add workspace-specific rules here — conventions, deviations, or additions to
the shared workflow rules embedded in \`AGENTS.md\`. This file is user-owned:
the Actorium extension never generates or overwrites it, so anything written
here survives \`AGENTS.md\` regeneration (e.g. after "Add Repo" or re-linking
the workspace folder).

If a rule here conflicts with a shared rule in \`AGENTS.md\`, the rule here
wins for this workspace.
`;

/**
 * Creates `WORKSPACE-RULES.md` at the workspace folder's root the first time
 * it's linked — a place for user-authored rules that must survive AGENTS.md
 * regeneration (unlike the marker-bounded generated section — see
 * agentsFile.ts). Never overwrites an existing file.
 *
 * Best-effort, like `ensureEnvFile`/`ensureEnvGitignored` (see envFile.ts):
 * this file is a convenience, not a requirement, so a failure to create it
 * must never block `regenerateAgentsFile`'s more important steps or the
 * "open workspace folder" flow that calls it.
 */
export async function ensureWorkspaceRulesFile(folderPath: string): Promise<void> {
  try {
    const rulesPath = path.join(folderPath, 'WORKSPACE-RULES.md');
    if (fsSync.existsSync(rulesPath)) return;
    await fs.writeFile(rulesPath, TEMPLATE, 'utf8');
  } catch {
    // Best-effort — see doc comment above.
  }
}
