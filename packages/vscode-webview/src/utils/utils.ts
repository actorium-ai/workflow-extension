export function toolLabel(name: string | undefined): string {
  const spaced = String(name || '')
    .replace(/_/g, ' ')
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : 'Tool call';
}

/**
 * Claude-Code-CLI-style "Tool(primary arg)" label for the IDE's own
 * client-executed (deferred) tools — e.g. `Read(src/login.ts)`,
 * `Bash(npm test)`. Params are only known once the hermes.tool.deferred
 * event arrives (see extension.ts's onDeferredToolCall →
 * ChatPanelProvider.setToolParams), so this falls back to the plain
 * humanized toolLabel() before that, and for every server-side tool (query_rag,
 * get_workspace_context, etc.) which never carries params at all.
 */
export function formatToolCallLabel(name: string, params?: Record<string, unknown>): string {
  if (!params) return toolLabel(name);

  const str = (key: string): string | undefined => {
    const v = params[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const truncate = (s: string, max = 60): string =>
    s.length > max ? s.slice(0, max - 1) + '…' : s;

  switch (name) {
    case 'read_file':
      return str('path') ? `Read(${str('path')})` : toolLabel(name);
    case 'edit_file':
      return str('path') ? `Edit(${str('path')})` : toolLabel(name);
    case 'write_file':
      return str('path') ? `Write(${str('path')})` : toolLabel(name);
    case 'create_directory':
      return str('path') ? `Create directory(${str('path')})` : toolLabel(name);
    case 'browse_directory':
      return `List(${str('path') || '.'})`;
    case 'search_code':
      return str('pattern') ? `Grep(${truncate(str('pattern')!)})` : toolLabel(name);
    case 'search_files':
      return str('pattern') ? `Glob(${truncate(str('pattern')!)})` : toolLabel(name);
    case 'run_command':
      return str('command') ? `Bash(${truncate(str('command')!)})` : toolLabel(name);
    case 'git_status':
      return 'git status';
    case 'git_diff':
      return 'git diff';
    case 'git_commit':
      return str('message') ? `git commit(${truncate(str('message')!)})` : 'git commit';
    case 'git_push':
      return 'git push';
    case 'git_checkout':
      return str('branch') ? `git checkout(${str('branch')})` : 'git checkout';
    case 'git_log':
      return 'git log';
    default:
      return toolLabel(name);
  }
}

/**
 * Claude-Code-style Ask-mode approval question — "Make this edit to
 * test.txt?" etc. — for the inline approval card (see ApprovalPrompt).
 * Shown just the basename, not the full path, matching the reference UX;
 * the full path is still visible in the tool-call row right above the card.
 */
export function formatApprovalQuestion(tool: string, params: Record<string, unknown>): string {
  const str = (key: string): string | undefined => {
    const v = params[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const basename = (p: string): string => p.split('/').pop() || p;

  switch (tool) {
    case 'edit_file':
      return str('path') ? `Make this edit to ${basename(str('path')!)}?` : 'Make this edit?';
    case 'write_file':
      return str('path') ? `Write to ${basename(str('path')!)}?` : 'Write this file?';
    case 'create_directory':
      return str('path') ? `Create directory "${str('path')}"?` : 'Create this directory?';
    case 'run_command':
      return 'Run this command?';
    case 'git_commit':
      return 'Commit these changes?';
    case 'git_push':
      return 'Push to remote?';
    case 'git_checkout':
      return str('ref') ? `Checkout "${str('ref')}"?` : 'Check out this ref?';
    default:
      return `Run ${toolLabel(tool)}?`;
  }
}

/**
 * Line-count diff stat for an edit_file call's `edits` param, in the same
 * spirit as Claude Code's "+3 -1" badge — per edit, the old_string's line
 * count is "removed" and the new_string's is "added". This is a simple
 * per-substitution approximation (not a true LCS line diff), computed
 * purely from the tool call's params — no execution result needed, so it's
 * available as soon as the deferred call's params are known, same as the
 * formatted label above. Returns null when there's nothing to show (no
 * edits, or malformed params).
 */
export function computeEditStats(
  params: Record<string, unknown> | undefined,
): { added: number; removed: number } | null {
  const edits = params?.edits;
  if (!Array.isArray(edits) || edits.length === 0) return null;

  const countLines = (s: unknown): number =>
    typeof s === 'string' && s.length > 0 ? s.split('\n').length : 0;

  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    if (typeof edit !== 'object' || edit === null) continue;
    const e = edit as Record<string, unknown>;
    added += countLines(e.new_string);
    removed += countLines(e.old_string);
  }
  return added || removed ? { added, removed } : null;
}

/**
 * Real added/removed line counts from a completed edit_file/write_file
 * result's `diff` field (FileOps.editFile/writeFile — computed from the
 * actual before/after file content via the `diff` package's diffLines, same
 * approach opencode's backend uses). Preferred over computeEditStats' params
 * heuristic whenever it's available (i.e. once the call is done) — that
 * heuristic only exists to show SOMETHING while the call is still running,
 * before a real result exists.
 */
export function extractRealDiffStats(output: unknown): { added: number; removed: number } | null {
  if (typeof output !== 'object' || output === null) return null;
  const diff = (output as Record<string, unknown>).diff;
  if (typeof diff !== 'object' || diff === null) return null;
  const d = diff as Record<string, unknown>;
  const additions = typeof d.additions === 'number' ? d.additions : 0;
  const deletions = typeof d.deletions === 'number' ? d.deletions : 0;
  return additions || deletions ? { added: additions, removed: deletions } : null;
}

/**
 * Real unified diff patch text from a completed edit_file/write_file
 * result's `diff.patch` field (FileOps.editFile/writeFile's createPatch
 * call) — lets ToolCallRow render an actual colored diff (see DiffView)
 * instead of a raw JSON dump when expanding the call. Null for anything
 * older than this feature (no `patch` field yet) or any non-diff tool.
 */
export function extractPatch(output: unknown): string | null {
  if (typeof output !== 'object' || output === null) return null;
  const diff = (output as Record<string, unknown>).diff;
  if (typeof diff !== 'object' || diff === null) return null;
  const patch = (diff as Record<string, unknown>).patch;
  return typeof patch === 'string' && patch.length > 0 ? patch : null;
}

/** Most tools (files.ts/git.ts/terminal.ts's ToolResultPayload) wrap their
 * real text in an `{ok, content}` / `{ok: false, error}` envelope — dumping
 * that whole object as JSON just to get at the text is pure noise (worse,
 * JSON.stringify escapes the content's own real newlines as literal `\n`
 * sequences). Show the actual string as-is whenever the envelope is that
 * shape, and only fall back to a JSON dump for output that has no single
 * text field to show (e.g. browse_directory's `{ok, files}` array). */
export function formatOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
    if (obj.ok === false && typeof obj.error === 'string') return obj.error;
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function formatRelativeTime(unixSeconds: number): string {
  const diffSeconds = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diffSeconds < 60) return 'just now';
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return totalSeconds + 's';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return minutes + 'm' + String(seconds).padStart(2, '0') + 's';
  const hours = Math.floor(minutes / 60);
  return hours + 'h' + String(minutes % 60).padStart(2, '0') + 'm';
}
