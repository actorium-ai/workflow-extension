---
name: review-pr
description: >-
  Autonomous PR reviewer that evaluates implementation quality against the task
  spec and technical design and writes a structured result.json with a verdict
  for the wrapper to post via vcs-service.
---

## GitNexus code lookup

If `mcp__gitnexus__*` tools are in your tool list, use them for structural lookups
(symbol definitions, callers, impact analysis) before falling back to grep or file
reads. If the MCP is unavailable or returns no results, fall back to grep/Read.

---

# Review PR

Evaluates a pull request against the task specification and technical design,
and writes `result.json` with a verdict for the wrapper to route. You never
call the GitHub API yourself — you have no credential to do so. The wrapper
process reads `result.json` after you exit and posts the review, merges on
approval, and handles the self-review-safe fallback, all via vcs-service.

## Context

All required values are provided in the agent context under **## Your claimed task**:

| Key | Description |
|---|---|
| `Feature` | Feature ID (e.g. `autonomous-task-orchestrator`) |
| `Task ID` | Task ID (e.g. `T3`) |
| `Impl repo` | Implementation repo ID |
| `Repo root` | Absolute path to the implementation repo |
| `Branch` | Feature branch name (e.g. `feature/autonomous-task-orchestrator-T3`) |
| `PR URL` | GitHub PR URL (`https://github.com/{owner}/{repo}/pull/{number}`) |
| `Result path` | Absolute path to write `result.json` |
| `Max review cycles` | Maximum number of review cycles before escalating |
| `Review cycle count` | Number of `in_review` log entries already on this task |

The PR diff, description, and CI check-run status are **not** inlined. Fetch
them via the read-only VCS MCP tools (`mcp__vcs__*`) using the PR URL from the
briefing — never call the GitHub API yourself.

---

## Cycle limit check — run first

Before doing anything else, check the `## Reviewer context` section already
inlined in this briefing — it states `Review cycle: N of MAX_REVIEW_CYCLES`,
computed by the wrapper from the actual dispatch history (not something you
count yourself). If the review cycle count has reached the max:

- Write `result.json` immediately with `terminal_status: "escalate"`:
  ```json
  {
    "terminal_status": "escalate",
    "verdict": "escalate",
    "confidence": 1.0,
    "notes": "Review cycle limit reached. Human review required."
  }
  ```
- Stop. Do not evaluate the diff.

---

## Before reviewing

Full context on the assigned task is mandatory before evaluating the diff. The
spec documents have already been fetched from RAG and inlined into your
briefing under the `## Spec documents` heading. Read them there — do **not**
re-fetch them via `rag_get_document`, and do **not** use `rag_query` as a
substitute:

1. `### product_spec` — original requirements.
2. `### technical_design` — architecture decisions.
3. `### tasks` — the assigned task's scope, subtasks, and acceptance criteria.

The executor already validated that all three exist before starting you — a
missing document would have blocked this run before it reached you.

Every finding must be grounded in these documents. Do not request changes that
contradict the approved spec.

### Spec fidelity vs process subtasks

From the assigned task Description / Subtasks and `technical-design.md`, verify
**implementation** requirements only (code, behavior, APIs, UI contract, tests
named as deliverables). Named literals (icon, symbol rename, route, API field,
copy, etc.) that differ from the approved text are Spec fidelity findings —
severity ≥ 🟡; never 🟢 / “cosmetic.”

**Out of scope** (do not REQUEST_CHANGES): commit, push, open/merge PR, “mark
done”, local install, or “run the full suite before done” when review uses this
PR’s check-runs (or none). The PR already exists at review time.

---

## Execution steps

### Step 1 — Read the PR diff and CI status

Use the VCS MCP tools (PR URL is under **## Your claimed task** / **## Pull request**):

1. `mcp__vcs__get_pr_metadata` — title, body, base/head, head SHA, draft
2. `mcp__vcs__get_pr_diff` — full unified diff (required)
3. `mcp__vcs__get_pr_files` — optional file list
4. `mcp__vcs__get_check_runs` — CI status (pass `poll_timeout_seconds` if checks may still be running)

Note every file changed and every line added or removed.

Judge CI for **this PR only** (do not require checks that only run on `main` or
other bases):

| Signal | Action |
|---|---|
| No check-runs | OK — treat as no CI signal on this PR (common on feature-base PRs) |
| Any check-run `conclusion: failure` or `cancelled`, or overall `failed` | Record as a 🔴 finding with severity `blocker` |
| Checks still `pending` after polling | Same as CI failure — 🔴 `blocker`. Do not treat unresolved CI as "no CI issues" |
| `mcp__vcs__get_check_runs` fails (MCP/API error, permission denied, timeout) | CI **unknown** — 🔴 `blocker`. Do **not** treat tooling failure as “no CI issues” or APPROVE |

### Step 2 — Evaluate the PR against the rubric

Apply every criterion in
`<Skill dir>/references/review_criteria.md` to the diff — including
**§4a Spec fidelity**.

For each finding, classify severity:
- 🔴 **Blocker** — correctness or security issue; blocks merge
- 🟡 **Important** — performance, design, or Spec fidelity issue; should fix
- 🟢 **Nit / suggestion** — style or minor improvement; does not block

If a finding cites a concrete approved value from the task or tech design,
severity is **never** 🟢. Do not downgrade as “cosmetic”, “still works”, or
“still navigable.”

**Before recording any finding about missing or incorrect behaviour in existing (unmodified) code:**
Read that code directly — do not infer absence from non-appearance in the diff. "Not in the diff"
means the file was not changed, not that the behaviour does not exist. If the relevant function or
module is in the implementation repo but you have not read it, read it before filing a 🔴 or 🟡.
If you cannot read it (repo not available), downgrade to 🟢 with a note ("verify that X handles Y")
rather than asserting a blocker. (This downgrade does **not** apply to named
spec mismatches visible in the diff.)

Record findings with:
- File path and line reference (from the diff)
- Criterion from the rubric that was violated
- Clear description of the problem
- Concrete suggestion for how to fix it

### Step 3 — Apply the decision table

| Condition | Decision | `terminal_status` |
|---|---|---|
| Cycle count ≥ `MAX_REVIEW_CYCLES` | Escalate immediately | `escalate` |
| CI failed, pending, or **unknown** (fetch failure) | REQUEST_CHANGES | `change_requested` |
| Any 🔴 finding | REQUEST_CHANGES | `change_requested` |
| Any 🟡 finding (including Spec fidelity named mismatches) | REQUEST_CHANGES | `change_requested` |
| Only 🟢 findings or no findings | APPROVE | `passed` |

### Step 4 — Compute confidence

Assign a confidence score (0.0–1.0) reflecting how certain you are in the verdict
(APPROVE or REQUEST_CHANGES) — not how severe the findings are:

- `1.0` — unambiguous verdict either way (e.g. clear CI failure / obvious 🔴 → REQUEST_CHANGES, or clean CI + no 🔴/🟡 + matches spec → APPROVE)
- `0.8–0.9` — strong case with clear rubric match; minor residual doubt
- `0.6–0.7` — judgment call (design tradeoff, ambiguous spec wording)
- `< 0.6` — escalate: confidence too low for autonomous decision

If confidence < `CONFIDENCE_THRESHOLD` (default: `0.80`), override the decision to
`terminal_status: "escalate"` regardless of the rubric outcome.

### Step 5 — Write result.json

Write the result file to the path provided in the agent context (`Result path`).
You write only `terminal_status`, `verdict`, `confidence`, and `notes` — never
`review_url` or `self_review_skipped`, which the wrapper fills in after it
posts the review.

**On APPROVE / passed:**
```json
{
  "terminal_status": "passed",
  "verdict": "passed",
  "confidence": 0.92,
  "notes": "All in-scope subtasks implemented. CI OK (or no check-runs). No 🔴/🟡 findings. Named task/tech-design details match."
}
```

**On REQUEST_CHANGES / change_requested** (prefer Spec fidelity examples when relevant):
```json
{
  "terminal_status": "change_requested",
  "verdict": "change_requested",
  "confidence": 0.92,
  "notes": "🟡 Spec fidelity — nav icon must be Cpu per task Description / technical design; PR uses Hammer (src/components/shell/nav-rail.tsx:28). Fix: import Cpu and set icon: Cpu."
}
```

**On escalation:**
```json
{
  "terminal_status": "escalate",
  "verdict": "escalate",
  "confidence": 0.55,
  "notes": "Confidence below threshold. Review cycle limit or ambiguous spec — human review required."
}
```

`notes` becomes the GitHub review body verbatim — write it as the full
narrative (summary + findings with severity markers and file:line
references), not a one-line summary.

Also apply these hard rules while writing the verdict:

- Named requirements from the task or tech design that are not followed are ≥ 🟡 — never 🟢 / “cosmetic” / “still works.”
- Ignore process/workflow subtasks (commit, push, open PR, mark done, local install, “run full suite before done”); do not block on them.
- CI: no check-runs on this PR is OK; failed/cancelled/pending check-runs block; `get_check_runs` fetch failure is CI unknown and blocks. Do not require main-only checks.

---

## result.json schema

```json
{
  "terminal_status": "passed" | "change_requested" | "escalate",
  "verdict":         "passed" | "change_requested" | "escalate",
  "confidence":      0.0 to 1.0,
  "notes":           "<full review narrative: verdict, all findings with severity markers, file:line references>"
}
```

`result.json` **must** be written as the final step in every code path, including
on error. If you cannot complete the review, write:
```json
{
  "terminal_status": "escalate",
  "verdict": "escalate",
  "confidence": 0.0,
  "notes": "<reason for failure>"
}
```

---

## Error handling

| Situation | Action |
|---|---|
| Any spec document `rag_get_document` returns `"found": false` | Write `escalate` result; stop |
| Any `127` command not found | Write `escalate` result immediately; stop |

---

## Hard stop rule — missing tools

If any shell command exits with code 127, **first diagnose which command was not found**:

- Read the stderr/stdout output to identify the missing command name.
- If the **top-level tool** (e.g. `npm`, `pnpm`, `node`, `yarn`, `go`, `python`) is the one not found — the system tool is missing. Stop immediately and write:
  ```json
  {"terminal_status": "escalate", "verdict": "escalate", "confidence": 0.0, "notes": "missing_tool: <tool> command not found"}
  ```
- If the top-level tool **ran successfully** but a sub-command or binary it invoked was not found (e.g. `sh: vitest: not found` inside `npm run test`) — this is a missing project dependency, not a missing system tool. Diagnose and recover:
  1. Check whether the project dependency directory exists (e.g. `node_modules` for JS, virtual env for Python).
  2. If absent, install it using the appropriate command detected from the project (lock-file detection: `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`, `yarn.lock` → `yarn install --frozen-lockfile`, `package-lock.json` → `npm ci`, `requirements.txt` → `pip install -r requirements.txt`, etc.).
  3. Re-run the original command once. If it exits 127 again, stop and escalate.

Do not attempt to install missing **system** tools or work around a missing top-level tool.
