import { execFile as execFileCb } from 'child_process';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

export interface McpConnectResult {
  ok: boolean;
  message: string;
}

export type AgentTarget = 'claude' | 'codex' | 'opencode';

export interface AgentStatus {
  registered: boolean;
  /** Only meaningful when `registered` is true. `true`/`false` when we could
   * verify actual connectivity (Claude Code's `mcp get` does a real health
   * check); `undefined` when we can only confirm the config entry exists,
   * not whether it currently works (Codex, opencode). */
  connected?: boolean;
  detail?: string;
}

const MCP_SERVER_NAME = 'actorium-mcp';
const MCP_BIN = 'actorium-mcp';

/** Fallback npm package for installMcpCli when the BFF's version-gate
 * response hasn't been fetched yet (or omitted npm_package) — matches
 * workflow-mcp's actual published package name. */
export const DEFAULT_MCP_NPM_PACKAGE = '@actorium-ai/actorium-mcp';

function envArg(bffUrl: string): string {
  return `API_URL=${bffUrl}`;
}

/**
 * Ensures pnpm's global bin dir is on PATH for CLI subprocesses we spawn,
 * regardless of whether the calling shell ever sourced `~/.zshrc` (the same
 * gap `pnpm setup` leaves for IDE-launched processes — see the Makefile's
 * `link`/`unlink` targets). Without this, `claude`/`codex`'s own health
 * check — which spawns actorium-mcp as ITS child, inheriting whatever PATH
 * we hand `claude`/`codex` here — can fail with ENOENT even though the
 * binary is actually linked and working.
 */
function envWithPnpmBin(): NodeJS.ProcessEnv {
  const pnpmHome = process.env.PNPM_HOME || path.join(os.homedir(), 'Library', 'pnpm');
  const currentPath = process.env.PATH ?? '';
  const alreadyPresent = currentPath.split(path.delimiter).includes(pnpmHome);
  return {
    ...process.env,
    PNPM_HOME: pnpmHome,
    PATH: alreadyPresent ? currentPath : `${pnpmHome}${path.delimiter}${currentPath}`,
  };
}

function cliErrorMessage(cli: string, err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') {
    return `"${cli}" CLI not found on your PATH — install it first, then try again.`;
  }
  const stderr = (err as { stderr?: string })?.stderr;
  return `Failed with ${cli}: ${stderr?.trim() || (err instanceof Error ? err.message : String(err))}`;
}

// ── actorium-mcp CLI itself ──────────────────────────────────────────────────

export interface McpCliStatus {
  installed: boolean;
  /** Only set when `installed` is true — the version actorium-mcp's own
   * `--version` flag reports (see workflow-mcp's src/index.ts). */
  version?: string;
}

/**
 * Checks whether the `actorium-mcp` binary itself is on PATH — distinct from
 * per-agent registration (AgentStatus above): a binary can be installed with
 * no agent registered yet, or (in theory) registered with a dangling
 * reference if it was uninstalled afterward. Shells out to `--version`
 * rather than `command -v`/`which`, since that's the one check that both
 * confirms presence AND reports the version in a single round trip, using
 * the same PATH-repair env every other status check here needs.
 */
export async function getMcpCliStatus(): Promise<McpCliStatus> {
  try {
    const { stdout } = await execFile(MCP_BIN, ['--version'], { env: envWithPnpmBin() });
    return { installed: true, version: stdout.trim() };
  } catch {
    return { installed: false };
  }
}

/**
 * Installs the actorium-mcp CLI globally via npm — the one install path that
 * works for any user regardless of whether they have pnpm's global bin dir
 * set up (unlike this repo's own `make link`, which is a maintainer-only dev
 * loop against a local source checkout, not something an end user of the
 * packaged extension can run).
 */
export async function installMcpCli(npmPackage: string): Promise<McpConnectResult> {
  try {
    await execFile('npm', ['install', '-g', npmPackage]);
    return { ok: true, message: `Installed "${npmPackage}" globally via npm.` };
  } catch (err) {
    return { ok: false, message: cliErrorMessage('npm', err) };
  }
}

// ── Claude Code ──────────────────────────────────────────────────────────────

/**
 * Registers actorium-mcp with Claude Code by shelling out to its own
 * `claude mcp add` — safer than hand-writing Claude Code's own config file
 * (an internal format that can change between versions). `--scope local`
 * writes it under `cwd`'s project entry, so `cwd` should be the workspace
 * folder the agent will actually be opened in.
 */
export async function connectClaudeCode(cwd: string, bffUrl: string): Promise<McpConnectResult> {
  const args = [
    'mcp',
    'add',
    MCP_SERVER_NAME,
    '--scope',
    'local',
    '--env',
    envArg(bffUrl),
    '--',
    MCP_BIN,
  ];
  try {
    await execFile('claude', args, { cwd });
    return { ok: true, message: `Registered "${MCP_SERVER_NAME}" with Claude Code (local scope).` };
  } catch (err) {
    return { ok: false, message: cliErrorMessage('claude', err) };
  }
}

export async function disconnectClaudeCode(cwd: string): Promise<McpConnectResult> {
  try {
    await execFile('claude', ['mcp', 'remove', MCP_SERVER_NAME, '--scope', 'local'], { cwd });
    return { ok: true, message: `Removed "${MCP_SERVER_NAME}" from Claude Code (local scope).` };
  } catch (err) {
    return { ok: false, message: cliErrorMessage('claude', err) };
  }
}

/**
 * `claude mcp get <name>` exits 1 with "No MCP server named ..." on stderr
 * when unregistered, and exits 0 with a `Status: ✔ Connected` / `Status: ✘
 * Failed to connect` line (plus an `Issue:` line on failure) when it's a
 * real, health-checked registration — verified directly against the
 * installed Claude Code CLI rather than assumed.
 */
export async function getClaudeCodeStatus(cwd: string): Promise<AgentStatus> {
  try {
    const { stdout } = await execFile('claude', ['mcp', 'get', MCP_SERVER_NAME], {
      cwd,
      env: envWithPnpmBin(),
    });
    const connected = /Status:\s*✔/.test(stdout);
    const issue = stdout.match(/Issue:\s*(.+)/)?.[1]?.trim();
    return { registered: true, connected, detail: issue };
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr ?? '';
    if (/No MCP server named/.test(stderr)) return { registered: false };
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { registered: false, detail: '"claude" CLI not found on PATH' };
    }
    return { registered: false, detail: cliErrorMessage('claude', err) };
  }
}

// ── Codex ────────────────────────────────────────────────────────────────────

/**
 * Same idea for Codex — it has its own `codex mcp add` CLI mirroring Claude
 * Code's, so this shells out rather than hand-writing ~/.codex/config.toml.
 */
export async function connectCodex(cwd: string, bffUrl: string): Promise<McpConnectResult> {
  const args = ['mcp', 'add', MCP_SERVER_NAME, '--env', envArg(bffUrl), '--', MCP_BIN];
  try {
    await execFile('codex', args, { cwd });
    return { ok: true, message: `Registered "${MCP_SERVER_NAME}" with Codex.` };
  } catch (err) {
    return { ok: false, message: cliErrorMessage('codex', err) };
  }
}

export async function disconnectCodex(cwd: string): Promise<McpConnectResult> {
  try {
    await execFile('codex', ['mcp', 'remove', MCP_SERVER_NAME], { cwd });
    return { ok: true, message: `Removed "${MCP_SERVER_NAME}" from Codex.` };
  } catch (err) {
    return { ok: false, message: cliErrorMessage('codex', err) };
  }
}

/**
 * `codex mcp get <name>` prints the resolved TOML entry (config only, no
 * documented live health check unlike Claude Code's — not verified
 * hands-on, Codex isn't installed in this environment) — treated as
 * "registered" only, never claiming `connected` since that isn't a check we
 * can actually stand behind here.
 */
export async function getCodexStatus(cwd: string): Promise<AgentStatus> {
  try {
    await execFile('codex', ['mcp', 'get', MCP_SERVER_NAME], { cwd, env: envWithPnpmBin() });
    return { registered: true };
  } catch (err) {
    const combined = `${(err as { stderr?: string })?.stderr ?? ''}${(err as { stdout?: string })?.stdout ?? ''}`;
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { registered: false, detail: '"codex" CLI not found on PATH' };
    }
    if (/not found|no such|no server/i.test(combined)) return { registered: false };
    return { registered: false, detail: cliErrorMessage('codex', err) };
  }
}

// ── opencode ─────────────────────────────────────────────────────────────────

/**
 * opencode has no equivalent CLI subcommand — it reads a plain project-root
 * `opencode.json` file instead (see opencode's own MCP-server docs: an
 * `mcp` object keyed by server name, `type: "local"` + a `command` array +
 * `environment`). This merges a new `mcp.actorium-mcp` entry into the
 * workspace folder's own `opencode.json`, preserving whatever else is
 * already there rather than overwriting the whole file.
 */
export async function connectOpencode(
  workspaceFolderPath: string,
  bffUrl: string,
): Promise<McpConnectResult> {
  const filePath = opencodeConfigPath(workspaceFolderPath);
  const parsed = await readOpencodeConfig(filePath);
  if ('error' in parsed) return parsed.error;

  const { config } = parsed;
  const mcp =
    config.mcp && typeof config.mcp === 'object' ? (config.mcp as Record<string, unknown>) : {};
  mcp[MCP_SERVER_NAME] = {
    type: 'local',
    command: [MCP_BIN],
    environment: { API_URL: bffUrl },
    enabled: true,
  };
  config.mcp = mcp;

  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { ok: true, message: `Added "${MCP_SERVER_NAME}" to ${filePath}.` };
}

/** Removes just the `mcp.actorium-mcp` entry, leaving the rest of
 * opencode.json (other servers, unrelated settings) untouched. */
export async function disconnectOpencode(workspaceFolderPath: string): Promise<McpConnectResult> {
  const filePath = opencodeConfigPath(workspaceFolderPath);
  const parsed = await readOpencodeConfig(filePath);
  if ('error' in parsed) return parsed.error;

  const { config } = parsed;
  const mcp =
    config.mcp && typeof config.mcp === 'object' ? (config.mcp as Record<string, unknown>) : {};
  if (!(MCP_SERVER_NAME in mcp)) {
    return { ok: true, message: `"${MCP_SERVER_NAME}" was not registered in ${filePath}.` };
  }
  delete mcp[MCP_SERVER_NAME];
  config.mcp = mcp;

  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { ok: true, message: `Removed "${MCP_SERVER_NAME}" from ${filePath}.` };
}

/** Pure file check — presence of an enabled `mcp.actorium-mcp` entry.
 * There's no opencode CLI to ask for a live health check, so this only ever
 * reports registration, never connectivity. */
export async function getOpencodeStatus(workspaceFolderPath: string): Promise<AgentStatus> {
  const filePath = opencodeConfigPath(workspaceFolderPath);
  const parsed = await readOpencodeConfig(filePath);
  if ('error' in parsed) return { registered: false, detail: parsed.error.message };

  const entry = (parsed.config.mcp as Record<string, unknown> | undefined)?.[MCP_SERVER_NAME] as
    { enabled?: boolean } | undefined;
  if (!entry) return { registered: false };
  return { registered: entry.enabled !== false };
}

function opencodeConfigPath(workspaceFolderPath: string): string {
  return path.join(workspaceFolderPath, 'opencode.json');
}

async function readOpencodeConfig(
  filePath: string,
): Promise<{ config: Record<string, unknown> } | { error: McpConnectResult }> {
  if (!fsSync.existsSync(filePath)) return { config: {} };
  try {
    return { config: JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown> };
  } catch {
    return {
      error: {
        ok: false,
        message: `${filePath} exists but isn't valid JSON — fix or remove it first, then retry.`,
      },
    };
  }
}

// ── Generic fallback ─────────────────────────────────────────────────────────

/**
 * Generic fallback for any other MCP-capable client — the de facto common
 * `mcpServers` config shape (the same one Claude Desktop/Cursor/etc. use),
 * for the caller to copy to the clipboard and hand to the user to paste
 * wherever their tool expects it. Returns plain text rather than touching
 * `vscode.env.clipboard` itself, keeping this module free of the `vscode`
 * import — everything else here is plain Node/filesystem logic, testable
 * outside the extension host.
 */
export function genericMcpConfigSnippet(bffUrl: string): string {
  const snippet = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: MCP_BIN,
        env: { API_URL: bffUrl },
      },
    },
  };
  return JSON.stringify(snippet, null, 2);
}
