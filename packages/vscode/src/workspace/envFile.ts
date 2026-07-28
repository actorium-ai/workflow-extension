import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

const ENV_TEMPLATE = 'FIGMA_PERSONAL_ACCESS_TOKEN=\nGITHUB_TOKEN=\n';

/**
 * Creates a blank `.env` at the workspace folder's root the first time it's
 * linked, so agents (and the Figma MCP usage rule in AGENTS.md) have a
 * fixed place to read `FIGMA_PERSONAL_ACCESS_TOKEN`/`GITHUB_TOKEN` from.
 * Never overwrites an existing `.env` — it may already hold real tokens.
 *
 * `.env` is strictly a convenience, never a requirement: every token in it
 * is optional and agents must run normally without it (falling back to
 * local SSH / gh CLI / normal git auth), only preferring it when present.
 * So this — and `ensureEnvGitignored` below — swallow every error rather
 * than throwing: a failure to create `.env` (e.g. a read-only folder) must
 * never block `regenerateAgentsFile`'s more important steps (AGENTS.md,
 * the workspace manifest) or the "open workspace folder" flow that calls it.
 */
export async function ensureEnvFile(folderPath: string): Promise<void> {
  try {
    const envPath = path.join(folderPath, '.env');
    if (fsSync.existsSync(envPath)) return;
    await fs.writeFile(envPath, ENV_TEMPLATE, 'utf8');
  } catch {
    // Best-effort — see doc comment above.
  }
}

/**
 * Ensures `.env` is git-ignored at the workspace folder's root — creates
 * `.gitignore` if missing, appends a `.env` line if the file exists but
 * doesn't already ignore it. Leaves every other line untouched. Best-effort
 * — see `ensureEnvFile`'s doc comment.
 */
export async function ensureEnvGitignored(folderPath: string): Promise<void> {
  try {
    const gitignorePath = path.join(folderPath, '.gitignore');
    if (!fsSync.existsSync(gitignorePath)) {
      await fs.writeFile(gitignorePath, '.env\n', 'utf8');
      return;
    }

    const existing = await fs.readFile(gitignorePath, 'utf8');
    const alreadyIgnored = existing.split('\n').some((line) => line.trim() === '.env');
    if (alreadyIgnored) return;

    const withTrailingNewline =
      existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
    await fs.writeFile(gitignorePath, `${withTrailingNewline}.env\n`, 'utf8');
  } catch {
    // Best-effort — see ensureEnvFile's doc comment.
  }
}
