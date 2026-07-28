# Shared workflow rules

## Feature lifecycle

Features follow this lifecycle:

- backlog
- in_design
- in_tdd
- ready_for_implementation
- in_implementation
- in_handoff
- done
- blocked
- cancelled

A feature starts in `backlog` and moves to `in_design` when work begins. `backlog` can also cancel directly to `cancelled`.

![Feature Lifecycle Workflow](docs/feature-workflow.png)

## Stage review status values

- draft
- awaiting_approval
- approved
- rejected

## Task status values

- todo
- ready
- in_progress
- blocked
- in_review
- reviewing
- review_passed
- review_incomplete
- change_requested
- done
- cancelled

## Workflow

1. Product owner produces the `product_spec` document
2. Human approves or rejects product spec
3. Tech lead uses `tech-lead` (Phase 1) to produce the `technical_design` document
4. Human approves or rejects technical design
5. Tech lead uses `tech-lead` (Phase 2) to produce the task breakdown (`tasks.md` narrative + task manifest)
6. Human approves tasks, which materializes them into the platform via `create-tasks` — the orchestrator's eligibility scan then picks up no-dependency tasks automatically
7. The orchestrator dispatches agents (or hands off to humans) to execute tasks in their real implementation repos
8. A `handoff` document is produced summarizing the completed feature
9. Human approves final handoff

`product_spec`, `technical_design`, `tasks`, and `handoff` are the four stage documents. They are versioned documents stored by the platform (`storage-service`), not files in a git repo — see **Task and feature state** below.

## Task structure rules

- Task state lives in the Actorium platform (Postgres), not in git. There is no per-task YAML file and no management repo.
- Tasks are created in bulk from the feature's approved `tasks.md` index table via the `create_tasks` API/MCP tool (see the `create-tasks` skill) once the `tasks` stage is approved — they are never hand-authored as individual records.
- Subtasks are recorded as checklist items in `tasks.md`, under each task's `### Subtasks` section — not as separate machine-tracked entities.
- Subtasks do not have their own lifecycle status.
- Task lifecycle status is tracked by the platform, not by a file.
- One task changes one repository only.
- If a logical change requires edits in two repos (e.g. move a file to repo A and update a reference in repo B), split it into two tasks — one per repo — with the second depending on the first.
- `repo` must match a repo registered in the workspace (see `list_workspace_repos` / the workspace's repo configuration).
- Every task carries:
  - `status`
  - `depends_on`
  - `actor_type` (`agent` | `human` | `either`)
  - `branch`
  - `blocked_reason` (when blocked)
  - `pr` (url, status)

## Task status transition rules

Valid transitions only — skipping a step is a rule violation:

```
todo → ready                  (auto-ready rule, applied by the platform when the last dependency is marked done)
ready → in_progress           (orchestrator claim, dispatched via start-implementation)
in_progress → in_review       (agent or human, after work is complete)
in_progress → blocked         (agent, when blocked)
in_review → reviewing         (orchestrator, on reviewer dispatch claim)
in_review → done              (human, or the orchestrator when the impl PR merges directly without a reviewer cycle)
in_review → ready             (human, when rejecting for rework)
in_review → review_incomplete (orchestrator, when reviewer exits without a valid result — up to MAX_REVIEW_INCOMPLETES times)
reviewing → review_passed     (orchestrator, when reviewer verdict is `passed` — APPROVE posted, awaiting impl PR merge)
reviewing → change_requested  (orchestrator, when reviewer posts REQUEST_CHANGES)
reviewing → review_incomplete (orchestrator, when reviewer exits without a valid result — up to MAX_REVIEW_INCOMPLETES times)
review_passed → done          (orchestrator, when the impl PR is observed merged on GitHub)
review_incomplete → reviewing (orchestrator, when re-dispatching reviewer on the next poll cycle)
review_incomplete → blocked   (orchestrator, after MAX_REVIEW_INCOMPLETES failed review attempts — escalates)
change_requested → in_progress  (orchestrator claim, dispatched to a fix agent)
blocked → <derived>           (via unblock_task — resume state is derived server-side from blocked_from_status, not chosen by the caller; see unblock-task skill)
any → cancelled               (human only)
```

- `todo → in_progress` is **never valid** — a task must pass through `ready` first.
- `start-implementation` must hard-stop if the task status is not `ready`.
- **Claims are database transactions, not git commits.** The orchestrator claims a task (`ready → in_progress`, `change_requested → in_progress`, `in_review → reviewing`) by atomically updating its status in the platform database before dispatching an executor — there is no management repo, no task branch, and no claim commit for agents to race on. The status column itself is the duplicate-claim guard: once a task is `in_progress` or `reviewing`, the orchestrator will not dispatch a second executor for it.
- **Unblock target rule**: the resume state after `unblock_task` is derived server-side from `blocked_from_status` — it is not chosen by the human or agent. See the `unblock-task` skill's blocked-cause taxonomy for the full mapping (`in_progress → ready`, `reviewing`/`in_review → in_review`, plus counter resets for specific `blocked_reason` values like `review_incomplete_exceeded`, `rebase_failed`, `max_turns`).
- **Review-passed holding rule**: after a `passed` verdict the task is set to `review_passed`, **not** back to `in_review`. Resetting to `in_review` would let the orchestrator's reviewable-tasks scan dispatch a fresh reviewer while waiting for the impl PR to merge, creating a duplicate-dispatch window. `review_passed` closes that window — it is excluded from the reviewable-tasks scan and exists solely as a holding state. The orchestrator's PR-merge poll continues to watch the PR; when GitHub reports it merged, the task moves `review_passed → done`.
- **Review-incomplete retry rule**: `review_incomplete → reviewing` is claimed the same way as reviewer dispatch (an atomic DB status update). After `MAX_REVIEW_INCOMPLETES` failures the orchestrator escalates directly to `blocked` instead of retrying.

![Task Status Workflow](docs/task-workflow.png)

## Task activity log

- Every task and feature state change is recorded automatically by the platform as an activity event (actor, action, timestamp, note) — there is no task log file for agents to edit, and no `date`-formatted timestamp for an agent to construct.
- Agents do not append log entries directly. State transitions happen through the sanctioned path for that transition (`start-implementation`, `pr-create`/`result.json`, `unblock_task`, etc.) and the platform records the activity as a side effect.
- Marking a task `done` from `in_review` (outside the impl-PR-merge path) is a human action.

### Representative activity actions

The list below illustrates the vocabulary seen in the platform's activity timeline — it is descriptive, not an exhaustive or agent-authored enum (the platform is authoritative for the actual set):

| Action | Meaning |
|---|---|
| `task_created` | task materialized into the platform from an approved `tasks.md` |
| `ready` | task's dependencies are satisfied; eligible for execution |
| `claimed` / `dispatched_at` set | orchestrator claimed the task and dispatched an executor |
| `rag_pre_flight` | RAG context injected before executor spawn |
| `started` | executor work phase begun |
| `blocked` | task set to `blocked`, with `blocked_reason` / `blocked_from_status` recorded |
| `reviewer_started` | reviewer executor claimed for dispatch |
| `reviewer_complete` | reviewer verdict applied — task mutated to `change_requested` or `review_passed` |
| `review_blocked` | reviewer exited without a valid result — task transitioned to `review_incomplete`; escalates to `blocked` after max attempts |
| `unblocked` | a human called `unblock_task`; resume state derived server-side |
| `done` | PR merged, or a human/reviewer agent accepted the work |
| `reap` | orchestrator reaped an executor's completion from the dispatch broker |
| `cancelled` | task or feature cancelled |
| `stage_approved` / `feature_status_changed` | feature-scope stage or status transition |

## Task write scope

Agents never write task or feature state directly (there is no shared file to write to). An executor's only sanctioned way to affect its own task's state is exiting with `result.json` (`terminal_status`, `blocked_reason`, etc.), which the orchestrator reads and applies. An executor must never attempt to mutate a different task's state, even for seemingly-valid reasons like schema migrations, audit entries, or bulk updates.

Cross-cutting changes that touch multiple tasks (e.g. a bulk status correction) must be:
- Planned as a dedicated task with a single executor, or
- Performed through a platform-level tool/migration outside the normal task-execution path — never by having one task's executor reach into another task's state.

## Dependency rules

- Every task must define `depends_on` (use `[]` if none)
- A task can only start when:
  - its status is `ready`
  - all tasks in `depends_on` are `done`
- This rule is enforced by `start-implementation`
- **Auto-ready rule**: when a task is marked `done`, the platform automatically advances any task whose entire `depends_on` list is now satisfied from `todo` to `ready`, in the same transaction. No agent or human needs to apply this transition manually.

## Execution rules

Each task carries `actor_type: human | agent | either`, set from the `tasks.md` index table's `Actor` column (defaults to `agent` when blank).

## Review boundary

- Agents may move work to `in_review`
- Humans review, validate, and decide whether work becomes `done`; reviewer agents may also mark `done` when CI and the quality rubric both pass
- Reviewer agents may set `change_requested` when posting a `REQUEST_CHANGES` GitHub review
- Agents do not approve stages
- Agents do not mark tasks `done` for tasks with `requires_human_review: true` — the reviewer still posts APPROVE but skips the PR merge, and the orchestrator waits for the human to merge the PR before marking the task `done` (via the existing in_review PR poll)

## Commit-before-block rule

Before an agent sets a task to `status: blocked` for **any** reason, it must:

1. **Commit all in-progress work** to the task's feature branch — even partial, even broken. Use a commit message that describes the state honestly (e.g. `wip(T3): partial indexer — blocked on Qdrant auth`).
2. **Push** the commit to origin so the next agent can see it.
3. **Set `blocked_reason`** — a clear description of what went wrong.
4. **Set `blocked_suggestion`** — a concrete next step for the agent that picks this up (e.g. "check Qdrant credentials in .env, re-run `qdrant_init.py` manually to verify connection, then continue from `services/indexer.py:142`").

This ensures the next agent inherits full context: code state on the branch, the reason for the block, and a starting point. An agent that blocks without committing its work wastes the next agent's time.

## Start rule

- Tasks marked `ready` are eligible for execution
- Execution must begin through `start-implementation`

## Context-gathering pre-flight

Before making any change or claim, gather real context — never act from the task title, a paraphrase, or an assumption about state carried over from earlier in the conversation. In order, as applicable to the work at hand:

1. **Resolve the workspace.** Confirm which Actorium workspace you're in — `.actorium/workspace.json`'s `workspaceId` for a linked local folder, or the `workspace_id` passed explicitly — before calling anything workspace-scoped.
2. **Resolve the feature.** If the work is feature-scoped, call `get_feature` for its current status/stage, documents, tasks, and activity. Do not assume a feature's state from memory — features change status/stage between turns and between sessions.
3. **Resolve the task.** If the work is a specific task, call `get_task` (or read it from `get_feature`'s embedded task list) for its full execution/PR/activity detail — status, `blocked_reason`, dependencies, branch, PR.
4. **Query RAG.** Follow the **RAG-first read rule** below — query before opening a file to look up code or prior context.
5. **Query GitNexus.** Follow the **GitNexus lookup priority rule** below — use it for structural code questions (symbols, callers, impact) before grep or full-file reads.
6. **Read the feature's docs when in a feature context.** If you're implementing, reviewing, or designing against a feature, read its `product_spec`, `technical_design`, and the relevant `tasks.md` section (via `read_storage_document`, or the documents already inlined in your briefing — see `start-implementation`'s Step 1) before writing anything. Do not implement from the task title or a summary alone.

Skipping a step because the answer "seems obvious" is exactly the failure mode this rule exists to prevent — stale or assumed context produces work that doesn't match the system's actual current state.

## Skill execution contract

When a workflow skill declares an autonomous execution contract — any instruction such as "do not stop after X", "proceed directly", "all steps are part of a single invocation", or "without pausing for human confirmation" — the agent must honour that contract in full:

- Complete every declared step in sequence without pausing or returning control to the user between steps.
- Do not stop after setup phases (branch creation, environment resolution, log entry) and wait for a prompt.
- Do not treat a partial completion (e.g. implementation only, branch setup only) as a finished invocation.
- If a blocking issue arises that cannot be resolved, set `status: blocked`, write `blocked_reason`, and stop — do not silently drop remaining steps.

Stopping early and waiting for the user to continue is a **contract violation** regardless of whether any individual step succeeded.

## Reset / rollback rule

- Stage resets preserve artifacts
- Downstream artifacts are marked for revalidation, not deleted

## Environment resolution rules

Environment resolution differs by context — there is no `workspace.yaml`/project `.env` pair to read in either case:

- **Agent runtime**: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, and other task-scoped values are injected directly into the executor's environment by the orchestrator before the skill runs — use them directly (`printenv`), do not try to resolve them from a file.
- **Interactive sessions**: the workspace identity (`workspaceId`, `orgId`) comes from `.actorium/workspace.json` (walk upward from the current directory to find it — written by the VS Code extension when the folder was linked), and repo-to-local-path mapping comes from `.actorium/repo-links.json`. Git identity comes from normal `git config` / the local SSH agent, not a hand-authored env file.
- If a required value truly can't be resolved from any of the above, ask the user instead of guessing.

## Figma link propagation rule

A Figma link in a product spec is a design contract. It must be carried forward through every downstream artifact that touches UI.

**Product spec → technical design:**
- If `product-spec.md` contains one or more Figma URLs, the tech lead must include a `## Figma` section in `technical-design.md` that lists every Figma URL and maps each one to the screens or components it covers.
- The technical design may not be marked `approved` if the product spec has Figma links and the technical design has no `## Figma` section.

**Technical design → tasks:**
- If `technical-design.md` has a `## Figma` section, every task in `tasks.md` that implements UI for a `frontend_engineer` repo must include a `### Figma` subsection listing the Figma URL(s) and frame names relevant to that task.
- A frontend task with no `### Figma` subsection when the technical design has Figma links is incomplete and must be corrected before the task is marked `ready`.

## Figma MCP usage rule

When `FIGMA_PERSONAL_ACCESS_TOKEN` is present in the project `.env` and `figma-mcp` is listed under the role's `enabled_skills`, agents must use the Figma MCP to read design context before implementing any UI.

- Read the target Figma frame or component via the MCP **before** writing code.
- Extract design tokens (colors, spacing, typography) from Figma variables — do not hardcode values that exist in Figma.
- Derive component and prop names from the Figma component name.
- If `FIGMA_PERSONAL_ACCESS_TOKEN` is missing, stop and ask the user to add it to `.env` (see `.env.template`).
- Never skip Figma context when the token is available — guessing at design values is not acceptable.

## Frontend engineer Figma implementation rule

When a task spec includes a `### Figma` subsection, the Figma design is the source of truth for visual output — not the text description.

- **Read first**: use the Figma MCP (`get_design_context` or `get_screenshot`) on every frame listed in `### Figma` before writing any UI code. Do not implement from the text description alone.
- **Token is available**: if `FIGMA_PERSONAL_ACCESS_TOKEN` is set, reading Figma context is mandatory. Skipping it is a rule violation.
- **Token is missing**: if the task has a `### Figma` subsection but `FIGMA_PERSONAL_ACCESS_TOKEN` is absent, set status to `blocked`, `blocked_reason: skill_missing`, and record in `blocked_details`: `"FIGMA_PERSONAL_ACCESS_TOKEN not set — cannot read Figma design"`. Do not implement from guesswork.
- **Fidelity**: the implemented UI must match the Figma frames for layout, spacing, color tokens, typography, and all interactive states (default, hover, focus, disabled, error, loading). Deviations require an explicit note in the PR description.
- **No orphan values**: every color, spacing, or typography value used in the implementation must map to a Figma variable or a codebase design token. Hardcoded hex or pixel values that exist in Figma are not acceptable.

## Task and feature state (no management repo)

**There is no management repo.** A prior "TS/git orchestrator" model stored feature docs and per-task YAML in a designated management repo (`workspace.yaml`'s `management_repo` field, `docs/features/<feature_id>/tasks/*.yaml`, claim commits on feature branches). That model, and the service that synced it (`workspace-github-adapter`), has been fully decommissioned — every feature in this workflow is now Postgres-native (see **Task structure rules** above). Do not look for, create, or write to a management repo for task or doc state.

Rules:
- Feature docs (`product_spec`, `technical_design`, `tasks`, `handoff`) and task state live in the Actorium platform (Postgres + `storage-service`), addressed by `feature_id` — not by a file path in a git repo. Read/write them through the `workflow-mcp` MCP tools (or the equivalent tool available to the acting agent), never via `git`.
- Nothing about task ownership or claiming involves a git commit. See **Task status transition rules** above — claims are atomic DB status transitions performed by the orchestrator.
- **No fabricated repo required**: workflow skills that used to resolve a management repo before operating on task state (`init-feature`, `approve-feature`, `create-tasks`, etc.) instead resolve the feature directly against the platform.
- **Dependency unblock rule**: whenever a task is marked `done`, the platform automatically checks every other task in the same feature whose `depends_on` list includes the just-completed task, and transitions each one whose dependencies are now all `done` from `todo` to `ready` — in the same transaction as the `done` update. No agent needs to apply this manually.
- Implementation repos are unaffected — they are still normal git repos with branches and PRs. See **Branch checkout + sync protocol**, **Rebase-before-PR rule** (under PR creation), and the git rules below, all of which apply to implementation repos only.

## Branch checkout + sync protocol

This protocol applies before any commit to an **implementation repo** during task execution (there is no management repo — see **Task and feature state** above). Run it whenever switching to or working on a feature branch.

### Step 1 — Ensure you are on the feature branch

```bash
git fetch origin
git checkout <feature-branch>   # create from the correct base if it doesn't exist yet
```

If the branch does not exist locally or on origin, determine the correct base before creating it:

**For implementation repos** — check whether a feature-level branch (`feature/<feature_id>`) exists on origin. If it does, the task is intra-feature and must be created from there:

```bash
# Intra-feature task: feature/<feature_id> exists on origin
git checkout -b <task-branch> origin/feature/<feature_id>

# Standalone task: no feature branch, create from base_branch
git checkout <base_branch> && git pull origin <base_branch>
git checkout -b <task-branch>
```

To check whether the feature branch exists:
```bash
git fetch origin
git show-ref --verify --quiet refs/remotes/origin/feature/<feature_id> && echo "exists" || echo "absent"
```

### Step 2 — Pull latest from origin

```bash
git pull origin <feature-branch>
```

If the pull succeeds (fast-forward or clean merge), continue.

### Step 3 — Handle a failed pull (force-push or diverged history)

If `git pull` is rejected because the origin branch has diverged (e.g. another agent force-pushed or rewound the branch), follow this recovery sequence:

1. **Save local changes** — capture everything this agent added on top of the base branch:
   ```bash
   git diff origin/main..HEAD > /tmp/<task-id>-local.patch
   git log origin/main..HEAD --oneline > /tmp/<task-id>-local-commits.txt
   ```
2. **Reset to main** and delete the stale local branch:
   ```bash
   git checkout main
   git branch -D <feature-branch>
   ```
3. **Re-checkout** the branch from origin:
   ```bash
   git checkout -b <feature-branch> origin/<feature-branch>
   ```
4. **Analyse before touching anything** — read the saved patch and the current branch state carefully:
   ```bash
   git diff origin/<feature-branch> /tmp/<task-id>-local.patch
   ```
   Answer these questions before doing anything else:
   - Is the local work already present on origin (same logical change, possibly different commit)? → discard the patch and continue.
   - Is the local work still required given the new origin state (e.g. the branch was rebased but our change is not there)? → apply only the missing parts.
   - Is the local work now obsolete or conflicting with origin (e.g. the feature was redesigned)? → commit the local patch as-is to the feature branch so it is not lost, then set `status: blocked` (see **Commit-before-block rule** below). Do not attempt to silently discard work.

   Only apply the patch when the answer to "still required and not yet present" is unambiguous.

### Step 4 — Rebase onto the PR base branch before committing

```bash
git fetch origin
git rebase origin/<pr_base_branch>
```

Where `<pr_base_branch>` is resolved in priority order (see the **PR creation rule** / `pr-create` skill for the full protocol):
- `TASK_BASE_BRANCH` — set by the orchestrator to the feature branch when the task is orchestrator-dispatched; use it directly when present.
- Otherwise, the repo's configured base branch — for standalone tasks whose PR targets the repo's main integration branch directly.

Do not hardcode `main`.

This keeps history linear and ensures the task branch includes all prior work from sibling tasks that have already merged into the feature branch.

### Scope

This protocol applies to implementation repos, before every implementation commit during task execution. It does not apply to task or feature state — there is no git write path for that (see **Task and feature state** above).

## Git / credential rules

- **Agent runtime:** there is no SSH and no GitHub token of any kind available to you. Git auth is handled entirely by wrapper code outside your process, via a short-lived `VCS_TOKEN` minted by vcs-service (HTTPS bearer auth) — you never see this token, never run `git push`, and never call the GitHub API. Just edit and commit locally.
- **Interactive sessions:** git uses the local SSH agent / `~/.ssh/config` — no env var needed.
- `SSH_KEY_PATH`, `SSH_PRIVATE_KEY`, and `GITHUB_TOKEN` are not workflow env vars — do not reference, require, or attempt to configure them.

## Git hard-reset safety rule

Before running `git reset --hard`, `git checkout --force`, or any other destructive
git operation on a repo, the agent **must** run both checks below and **hard-stop**
if either fails:

1. **Uncommitted changes check** — `git status --short`. If output is non-empty
   (staged, unstaged, or untracked tracked files), stop. Do not reset.
2. **Unpushed commits check** — `git log origin/<base_branch>..HEAD --oneline`.
   If output is non-empty, stop. Do not reset.

On hard-stop, report the exact output of the failing check and wait for the user to
resolve it (e.g. push, stash, or explicitly confirm discard) before proceeding.

This rule applies to every git repo touched in the workflow — implementation repos
and the workflow repo itself (there is no management repo to worry about).

## Pre-push checks rule

Before pushing any branch, run all tests and lint checks. Do not push if any tests fail or lint errors exist.

- Detect the test runner from the project (`package.json`, `Makefile`, `go.mod`, `pytest.ini`, etc.). Do not assume a specific runner.
- Run the full test suite, not a subset.
- Run the project's lint step (`eslint`, `golangci-lint`, `ruff check`, `flake8`, etc.) and fix all errors. Warnings are acceptable; errors are not.
- **Go projects**: `golangci-lint run` is mandatory before every commit — zero errors required. Install: `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest`
- Fix any failures and re-run until clean before pushing.

## Test-before-PR rule

- **Always run the full test suite before opening a PR.** This applies to every task, every workflow, every agent context.
- Use whatever test commands the implementation repo specifies — check the README, `package.json`, `Makefile`, `go.mod`, or equivalent build config. Do not assume a specific test runner or language.
- All tests must pass before invoking `pr-create`. Fix any failures and re-run until clean.
- **Default (interactive runs):** do not open a PR for failing tests. Hard-stop, set `status: blocked`, write `blocked_reason: tests_failed`, surface to the user.
- **Agent-runtime exception (`AGENT_RUNTIME=1`):** if tests cannot be made to pass after **3 attempts**, the agent **must still commit the failed attempt** (do not discard it) and write `result.json` with `terminal_status: blocked, blocked_reason: tests_failed`. Rationale: in agent-runtime mode the PR is the durable handover — a wrapper process pushes the branch and opens the draft PR after the agent exits regardless of outcome, so the next agent has a branch to inherit and the failed attempt isn't invisible. The orchestrator routes the blocked result to a fix agent / reviewer on the next cycle. This carve-out is product-vision sanctioned (revised D5 in the orchestrator design); do not read the default rule as forbidding it.

## PR creation rule

- **Agent runtime (`AGENT_RUNTIME=1`): you have no git-push credential and no GitHub API credential.** Never call `gh`, `curl` against the GitHub API, or `git push` yourself. A wrapper process pushes your commits and finds-or-creates the PR (with the correct title, see below) after you exit. The `pr-create` skill in this mode does nothing but write `result.json` — invoke it (or write `result.json` yourself) once your changes are committed.
- **Interactive runs (no `AGENT_RUNTIME`):** there is no wrapper — the `pr-create` skill pushes the branch itself, then finds-or-creates the PR via vcs-service (`POST /api/vcs/pr/find_or_create`), never `gh` or a direct GitHub API call. Invoke `pr-create` rather than calling `gh pr create` or `curl api.github.com` directly.

## Rebase and merge rules (implementation repos)

- **Rebase-before-PR rule**: before opening an implementation-repo PR (or pushing the final branch for review), the task branch must be rebased onto its **PR base branch**:
  - If the task's PR targets `feature/<feature_id>` (intra-feature task — the feature branch exists in the impl repo), rebase onto `origin/feature/<feature_id>`.
  - If the task's PR targets the repo's base branch directly, rebase onto `origin/<base_branch>`.
  - Resolve `<base_branch>` from `TASK_BASE_BRANCH` (set by the orchestrator) first, falling back to the repo's configured base branch — never assume `main`. This prevents duplicate commits from parallel tasks that merged while this task was in flight.
- **Rebase-before-done rule**: before a PR is merged (and a task marked `done`), the task branch must be rebased onto its PR base branch. A PR whose branch is not up-to-date with the base branch must not be merged — rebase it first, then merge.
- **Mergeable-before-close rule**: before the runtime merges a PR, it checks whether the PR is in a mergeable state. If the PR is `CONFLICTING` (`mergeable: false`), the merge is skipped and a not-mergeable event is emitted — the PR is left open; the task's `conflict_state` reflects this, and only the PR merge is deferred. If mergeability is `UNKNOWN` (GitHub has not finished computing it), the merge proceeds and any resulting error is handled by the standard merge-failure path. Operators must resolve the conflict on the feature branch and push before the next recovery cycle retries.

## PR title convention

PR titles must follow the format:

```
<type>(<featureId>/T<n>): <short description>
```

Examples:
- `feat(task-branch-lifecycle/T1): taskBranchName helper + BlockedContext schema`
- `fix(agent-runtime-hardening/T3): correct Dockerfile claude CLI install path`

Rules:
- `<type>` follows conventional commits (`feat`, `fix`, `chore`, `refactor`, `docs`, etc.)
- `<featureId>` is the feature directory name under `docs/features/`
- `T<n>` is the task ID
- Description is lowercase, imperative, no trailing period
- Keep the full title under 72 characters

## Git credential rule

- Agent runtime: no SSH, no GitHub token — a wrapper process outside your process handles all git push / GitHub API work via a short-lived `VCS_TOKEN` (vcs-service) you never see. Interactive sessions rely on the local SSH agent / `~/.ssh/config`.
- Agents must not attempt to read or configure SSH keys or tokens; `SSH_KEY_PATH`, `SSH_PRIVATE_KEY`, and `GITHUB_TOKEN` are not required or valid workflow variables

## Per-task required skills

Technical skills are declared per task, not per agent or per role. Each task's `## T<n>` section in `tasks.md` includes a `### Required skills` subsection listing the skill slugs the task needs. Skill slugs must match directory names under `workflow/claude/technical_skills/`.

At run-task time, the agent reads the declared skills and loads their `SKILL.md` content into its system prompt. This is the only capability-matching mechanism — there is no agent-side role or skills list.

See `tasks.md`'s `### Required skills` subsection as the source of truth for per-task capability.

## Narrative / state split

`tasks.md` is the narrative planning document — authored by humans (or the `tech-lead` skill), low write frequency. It carries task descriptions, required skills, model overrides, and the `### Subtasks` checklist. Agents read it and may check off subtask items, but do not otherwise rewrite its narrative content.

Machine-mutable state — `status`, `depends_on`, `blocked_reason`, `branch`, `actor_type`, `pr`, and activity history — lives in the Actorium platform database, not in `tasks.md` and not in any YAML file.

There is no git-push contention to isolate: the platform, not a shared file, serializes concurrent task updates. Multiple agents working different tasks in the same feature never race on a shared file for task state.

## Product-spec phase write boundary

During the `product_spec` stage, agents must not write or modify anything outside the feature's `product_spec` document.

If workspace-level changes are discovered as needed (e.g. missing repo entries, config typos, new skills, rule updates), the agent must **stop and list them explicitly for the human** instead of applying them. The human decides whether to apply them before or after the product spec is approved.

Examples of changes that must be surfaced, not applied:
- Edits to `AGENTS.md`'s non-generated sections, or the workspace's repo/model-policy configuration (managed by the platform, not a local file)
- Creating or modifying skills under `claude/technical_skills/`
- Registering new repos or roles
- Anything outside the feature's own `product_spec` document

## AGENTS.md edit policy

There is no `CLAUDE.shared.md` / `sync-workspace-rules` mechanism — the extension generates `AGENTS.md` directly (from live org/workspace/repo-link state and the `actorium-mcp` tool list) inside a marker pair (`actorium:generated:start` / `actorium:generated:end`), the same way the old `CLAUDE.md` used `BEGIN/END SHARED WORKFLOW RULES` markers.

- **Do not hand-edit the content between the generated markers** — it's regenerated by the extension whenever the repo links change, and hand edits there will be overwritten.
- Content **outside** the generated markers (above or below) is preserved across regeneration — that's where project-specific context and additional rules belong.
- If a rule genuinely needs to change for every workspace (not just this one), that's an extension-level change (what `agentsFile.ts` generates), not something a skill or agent edits per-project.

## Shell command permission policy

The assistant may run read-only inspection commands without asking first when working inside a project repository or workspace.

Examples of allowed read-only commands:

- `pwd`
- `ls`
- `find`
- `grep`
- `rg`
- `cat`
- `head`
- `tail`
- `git status`
- `git branch`
- `git diff --stat`

The assistant must still ask before running commands that:

- modify files
- delete files
- move files
- change permissions
- push to remote
- create or merge branches
- deploy infrastructure or applications

## Agent-runtime detection rule

Before implementing any code autonomously, check whether you are running inside the agent runtime:

```bash
printenv AGENT_RUNTIME
```

- If the output is `1` — you are inside the agent runtime. Proceed with autonomous implementation as instructed by the task.
- If the output is empty or the variable is absent — you are in an interactive session. **Do not implement code unless the human has explicitly asked you to in this conversation.** Read, plan, and discuss freely; write or modify files only on explicit instruction.

## Runtime ABI

The agent runtime is split into orchestrator and executor layers (see `agent-runtime-split` feature).
The orchestrator owns all workflow-state writes; the executor only performs code work and writes
`result.json`. This shared rules document contains workflow rules only — it is not injected into the
executor's runtime context.

The orchestrator is a Go binary that lives in the separate `workflow-orchestrator` repo and runs on
the host — it is not part of this repo and not a Docker service in this stack. This repo holds the
**workspace stack** it dispatches through: broker, dispatcher, and executor containers, running the
single `local-docker` topology (the earlier `local-subprocess` profile, where the orchestrator spawned
executors as local Node child processes in its own process, has been removed).

For third-party runtime authors and operators, the authoritative references are:
- **Portability spec**: `runtime/portability-spec.md` — ports, adapters, runner env contract, broker protocol fixtures
- **ABI spec**: `runtime/abi/docs/abi-spec.md` — executor-facing inputs, outputs, side-effects, lifecycle, examples
- **Root README**: `README.md` — workspace stack architecture and `./start.sh` setup

## RAG-first read rule

When the RAG MCP tool (`mcp__rag-server__rag_query`) is available, agents must query RAG before opening a file to look up code or context.

**Lookup order:**
1. Query RAG first via `mcp__rag-server__rag_query`
2. If results are relevant (high confidence), use them — do not open the file
3. Fall back to a direct `Read` only when RAG returns no results or low-confidence results

**Exceptions** — direct read without a prior RAG query is acceptable when:
- The file path is already known and a targeted line-range edit is the goal (not a lookup)
- The file is a config, lock, or generated file unlikely to be indexed
- The RAG MCP is unavailable for this run

This rule applies in both interactive sessions and agent runtime. Its purpose is to avoid loading entire files into context when the indexed corpus already contains the relevant excerpt.

## GitNexus lookup priority rule

When the GitNexus MCP tools (`mcp__gitnexus__*`) are available, agents must use them for structural code questions before falling back to grep or file reads.

**Lookup order:**
1. Use `mcp__gitnexus__query` to locate a symbol, function, class, or pattern across the repo
2. Use `mcp__gitnexus__context` to get callers, callees, and type relationships for a symbol
3. Run `mcp__gitnexus__impact` before any refactor or deletion to understand blast radius
4. Fall back to `grep` or `Read` only when GitNexus returns no results or the MCP is unavailable

**Other tools:**
- `mcp__gitnexus__detect_changes` — map a git diff or changed file list to the symbols it affects
- `mcp__gitnexus__list_repos` — discover which repos are indexed
- `mcp__gitnexus__group_query` — trace execution flows across multiple indexed repos

**Exceptions** — grep or direct read without a prior GitNexus query is acceptable when:
- GitNexus returns no results for the query
- The question is about raw file content, not code structure (e.g. reading a config, checking a comment)
- The `mcp__gitnexus__*` tools are absent from the tool list (indexer may not have completed a cycle yet)

**Never open an entire file** just to find a symbol when GitNexus can answer it directly. **Never skip GitNexus** when the tools are available and the question is structural.

The `mcp__gitnexus__*` tools appear when `GITNEXUS_MCP_URL` is set in the executor environment. TypeScript and Python are the primary indexed languages; for other languages verify coverage with grep if results seem incomplete. This rule applies in both interactive sessions and agent runtime. Its purpose is to leverage the pre-built AST + call-graph index for structural questions rather than doing expensive full-file reads or grep scans.

## Feature-branch and PR metadata

There is no `status.yaml` file — this described a git-file mechanism belonging to the retired TS/git orchestrator and its management repo (`feature_branch`, `feature_branch_base_sha`, `handoff_pr_url`, `impl_feature_prs`, `drift_detected`, `drift_reason`). In the current model, stage-level review state (`stages.product_spec`, `.technical_design`, `.tasks`, `.handoff` — each with `review_status`, `reviewed_by`, `reviewed_at`, `review_history`) and PR/branch metadata per task (`branch`, `pr.url`, `pr.status`, `conflict_state`, `workspace_pr`) are fields on the feature/task record itself, returned by `get_feature` — not a file agents read or write. Do not look for a `status.yaml` file; query the feature record instead.
