---
name: resume-feature
description: Resume a feature by summarizing current stage, approvals, blocking state, ready tasks, and next actions.
---

## Pre-flight

Before summarizing, fetch the current feature record via `get_feature` (or the equivalent tool available in this environment) rather than reading any local file — there is no management repo, so there is nothing to `git pull`. This ensures the summary reflects the platform's live state, not a stale local snapshot.

## Task
Read the feature artifacts and summarize:
- current status
- current stage
- approvals completed
- approvals missing
- dependency state
- tasks that can proceed now
- blocked tasks
- deployment readiness if relevant
- next required human decision
- next role that should act

## Wording rule
Do not say "assign" unless the workspace explicitly defines an assignment mechanism.

Use wording like:
- "Tasks T1 and T2 are ready. Owning teams may begin execution."
- "Task T4 is blocked by dependency T1."
- "No human decision is required at this stage."
