---
name: respond-to-review
description: Address PR review comments (review-fixes mode) or rebase the task branch after a base-branch advance (conflict-resolution mode).
---

## GitNexus code lookup

If `mcp__gitnexus__*` tools are in your tool list, use them for structural lookups (symbol definitions, callers, impact analysis) before falling back to grep or file reads. If the MCP is unavailable or returns no results, fall back to grep/Read — do not stop.

---

# Respond to Review

Two modes:

| Mode | When dispatched | What it does |
|---|---|---|
| `review-fixes` (default) | Task status `change_requested` — reviewer posted `REQUEST_CHANGES` | Fetch review body + threads via VCS MCP, address feedback, echo resolved thread IDs |
| `conflict-resolution` | Task status `in_review` and impl PR `mergeable: false` | Rebase the task branch onto its base, resolve conflicts safely (file ownership + dependency manifest union-merge) |

The briefing above already tells you which mode applies and states it explicitly ("**review-fixes** mode" or "**conflict-resolution** mode"). Branch by that.

**You never call the GitHub REST or GraphQL API, and you never run `git push`** — a wrapper process does all writes after you exit. For review-fixes, fetch review history and threads via the read-only VCS MCP tools listed under `## Review feedback` in the briefing. Do not invent feedback.

---

## Common context

Provided in your prompt under `## Your claimed task`:

| Key | Description |
|---|---|
| `Feature` | Feature ID |
| `Task ID` | Task ID |
| `Impl repo` | Implementation repo ID |
| `Repo root` | Absolute path to the impl repo (use `$TASK_REPO_PATH` env var preferentially) |
| `Branch` | Task branch (e.g. `feature/<feature_id>-<task_id>`) |
| `PR URL` | GitHub PR URL |

Real env vars set by the executor (available in your shell):
- `$RESULT_PATH` — write `result.json` here before exit (mandatory)
- `$RESOLVED_THREADS_PATH` — review-fixes mode only; write the JSON array of resolved thread IDs here (see A.3)
- `$TASK_REPO_PATH` — the impl repo, already checked out on your task branch

There is no `$GITHUB_TOKEN`, no `$MODE`, no `$REVIEW_URL`, no `$TASK_BASE_BRANCH` env var — the review URL, base branch, and mode are stated directly in the briefing prose above instead.

## Before any changes

**`MODE=review-fixes`:** The spec documents have already been fetched from RAG
and inlined into your briefing under the `## Spec documents` heading — read them
there to stay in scope (`### product_spec`, `### technical_design`, and the
assigned `### tasks` section). Do **not** re-fetch them via `rag_get_document`,
and do **not** use `rag_query` as a substitute. The executor already validated
that all three exist before starting you — a missing document would have
blocked this run before it reached you.

**`MODE=conflict-resolution`:** No `## Spec documents` block is provided — this
is a mechanical rebase. Resolve conflicts per the safety guards below; do not
make scope changes.

If a review comment or conflict resolution would require deviating from the
spec, do **not** silently comply — note the conflict in the log entry /
result.json notes.

---

# Mode A — review-fixes

Dispatched when the task is `change_requested` and the reviewer posted a `REQUEST_CHANGES` review.

## A.1 — Fetch review feedback via VCS MCP

Follow `## Review feedback` in the briefing:

1. Call `mcp__vcs__get_review_history` with the PR URL. If the briefing lists a Review URL, also pass it as `html_url`. The tool returns **at most one** review (matching `html_url`, or else the latest `CHANGES_REQUESTED`). **The review `body` is the primary feedback** — address it even when there are no inline threads. If formal reviews are empty (self-review often posts an issue comment instead), the MCP still returns that comment body as the review — treat it the same way.
2. Optionally call `mcp__vcs__get_review_threads` with the PR URL. Reviewers usually post body-only formal reviews, so threads are often empty — that does **not** mean “nothing to do.”

Do not scan a full review history client-side; the MCP already trimmed it.

## A.2 — Address each finding

You are already in `$TASK_REPO_PATH`, on the correct branch, with no fetch/checkout needed. For each actionable item from A.1 (review body + any threads):
1. Read the requested change.
2. Open the referenced file (and line, when given).
3. Apply the fix.
4. Stage + commit:
   ```bash
   git add <changed-files>
   git commit -m "fix: address review comment — <brief description>"
   ```

Batch closely related changes into one commit. Unrelated fixes get separate commits. Committing is recommended for a clean history, but not strictly required — the wrapper commits any uncommitted changes as a catch-all after you exit.

Run any available local lint / type-check (`npm run typecheck`, `tsc --noEmit`, `gofmt -l .`, `ruff check .`) before finishing. If the tool is not installed (exit 127), skip — CI will check.

## A.3 — Echo back which threads you resolved

Write the `threadId`s you addressed to `$RESOLVED_THREADS_PATH` as a JSON array:

```json
["thread-id-1", "thread-id-2"]
```

Use `[]` if there were no inline threads (body-only review is fine). **You never resolve threads yourself** — no GraphQL, no GitHub API call. The wrapper reads this file after publishing your commits and resolves each thread via vcs-service, best-effort.

## A.4 — Write result.json + exit

```json
{"terminal_status": "in_review"}
```

Do not include `pr_url` — the wrapper already knows it and fills it in. Do not push, do not toggle the PR's draft state, do not call the GitHub API — the wrapper owns all of that after you exit.

If you cannot complete the fix (e.g. the requested change conflicts with the spec docs, or you cannot safely resolve it), write blocked instead:
```json
{"terminal_status": "blocked", "blocked_reason": "<reason>", "blocked_suggestion": "<details>"}
```

Do not modify the task YAML — the orchestrator handles state transitions.

---

# Mode B — conflict-resolution

Dispatched when the task is `in_review` and `checkInReviewPrs` reports `mergeable: false`. Your job: rebase the task branch onto its base and resolve any conflicts within the agent's authored scope. **You rebase locally only — you never push, not even with force.** A wrapper process force-pushes your rebased branch (via `--force-with-lease`) after you exit.

## B.1 — Set up

```bash
cd "$TASK_REPO_PATH"
git fetch origin
git checkout -B "<Branch>" "origin/<Branch>"
```

Capture the set of files the agent authored on this branch — needed for the file-ownership guard in B.3.c:

```bash
git diff --name-only "origin/<base-branch>...HEAD" > /tmp/agent-authored-files.txt
```

(The base branch to rebase onto is stated in the briefing above.)

Abort any in-progress rebase before starting:

```bash
git rebase --abort 2>/dev/null || true
```

## B.2 — Attempt the rebase

```bash
git rebase "origin/<base-branch>"
```

Three outcomes — branch by exit status:

### B.2.a — Clean rebase (exit 0)

Skip to B.4 (write result.json — no push).

### B.2.b — Conflicted rebase

```bash
git diff --name-only --diff-filter=U > /tmp/conflicted-files.txt
```

Branch by who owns the conflicted files (B.3).

### B.2.c — Other error (corrupted index, etc.)

`git rebase --abort`, write blocked result.json with `blocked_reason: "rebase_error"`, exit.

## B.3 — Resolve conflicts (safely)

For every file in `/tmp/conflicted-files.txt`:

### B.3.a — Dependency manifests get a union merge

If the file basename is one of `package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`:
- Take the union of both sides. Include all packages/versions from both `HEAD` and the base branch. Where two sides specify different versions for the same package, take the HIGHER version.
- For `package.json`: merge `dependencies` and `devDependencies` keys; do not drop entries from either side.

### B.3.b — Agent-authored conflicts get auto-resolved

If the file is in `/tmp/agent-authored-files.txt`:
- Read both sides of the conflict (between `<<<<<<<` and `>>>>>>>`).
- Preserve ALL functionality from both sides. Do not drop code unless it's literally identical.
- Use comments to mark intentional choices if unsure.

### B.3.c — Human-authored files are off-limits

If the conflicted file is **not** in `/tmp/agent-authored-files.txt`, **do not modify it**. This is a human-owned file. Auto-resolving here risks dropping work the human committed.

Instead:
1. `git rebase --abort`
2. Write blocked result.json:
   ```json
   {"terminal_status": "blocked", "blocked_reason": "pr_conflict_human_files", "blocked_suggestion": "Conflicts in human-owned files: <comma-separated paths>. Manual resolution required."}
   ```
3. Exit.

### B.3.d — Continue the rebase

After resolving conflicts in agent-authored / dependency files:

```bash
git add -A
GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true git rebase --continue
```

If `--continue` fails, repeat B.2.b/B.3 (a multi-commit rebase can stop at several commits in sequence). Cap at **10 rounds** to avoid infinite loops:
- If the same set of files is still conflicted after one resolution pass, your fix didn't work — go to B.3.c's blocked path.
- If 10 rounds elapse without clean completion, blocked path.

## B.4 — Write result.json + exit

On clean rebase (or successful conflict resolution), stop here — **do not push, do not force-push**:

```json
{"terminal_status": "in_review", "notes": "Rebased onto <base branch> and resolved conflicts locally; wrapper will force-push."}
```

Do not include `pr_url` — the wrapper already knows it. The wrapper force-pushes your rebased branch after you exit; if that push itself fails (e.g. a concurrent writer advanced the remote branch), that surfaces as a recovery-level blocked result — not something you handle here.

The orchestrator reads your result and writes `conflict_state: resolved` to the task YAML (you don't touch the YAML directly).

---

## Hard rules (both modes)

1. **Write result.json to `$RESULT_PATH` before exit.** Mandatory — a text-only response without it is a failure.
2. **Never push, never call the GitHub API.** You only edit local files and commit locally. A wrapper process publishes your changes (and resolves threads / force-pushes rebases) after you exit.
3. **Do not modify the task YAML or any management-repo file.** The orchestrator owns workflow state.
4. **Stay in scope.** In `review-fixes` mode the `## Spec documents` block in your briefing (product_spec, technical_design, assigned task section) is the source of truth. If a review comment contradicts the spec, log the conflict in result.json `notes` and do not silently comply.
5. **Code 127 (missing tool)** → write `{"terminal_status": "blocked", "blocked_reason": "missing_tool"}` and exit. Do not try to install system tools.
