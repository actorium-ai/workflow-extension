# Actorium Agent

Agent-native delivery system, right inside VS Code.

Actorium connects your editor to your Actorium workspace and to your own local coding agent
(Claude Code, or any other agent that reads `AGENTS.md` / talks MCP). It doesn't run a chat of
its own — instead it signs you in once, keeps a local **workspace folder** linked with your
project repos symlinked into it, and generates an `AGENTS.md` there so your agent knows how to
call the sibling `workflow-mcp` server for this workspace's live feature/task/doc data, with no
manual credential setup.

## Features

- **Navigator** — a sidebar view listing the current workspace's linked local repos, documents,
  and features. Add a repo via auto-search or a manual folder pick; click a doc to open it.
- **Workspace folder** — a plain local directory per organization that your project clones get
  symlinked into, with a generated `AGENTS.md` describing what's linked and how to use
  `workflow-mcp` from there. Open it in a new window to start working with a local agent.
- **Auth** — a single OAuth sign-in here is enough for `workflow-mcp` too: this extension writes
  a shared local credential file that `workflow-mcp` reads automatically, so no cookie/token has
  to be copied by hand.

## Getting started

1. Install the extension and open the Actorium icon in the activity bar.
2. Run **Actorium: Connect** to sign in, then select an organization/workspace.
3. Link a workspace folder when prompted (or run **Actorium: Open Workspace Folder** any time),
   then **Actorium: Add Repo** to symlink in the project(s) you're working on.
4. Open the workspace folder in your local coding agent — its generated `AGENTS.md` explains how
   to reach `workflow-mcp` for this workspace's docs/features/tasks.

## Commands

| Command | Description |
| --- | --- |
| `Actorium: Connect` | Sign in to your Actorium account |
| `Actorium: Disconnect` | Sign out |
| `Actorium: Switch Workspace` | Change the active workspace |
| `Actorium: Open Workspace Folder` | Link (if needed) and open the current org's local workspace folder in a new window |
| `Actorium: Add Repo` | Symlink a local git clone into the workspace folder, via auto-search or a manual folder pick |
| `Actorium: Check for Updates` | Check whether a newer extension version is available |
| `Actorium: Account` | Open the account menu |

## Settings

| Setting | Description |
| --- | --- |
| `actorium.environment` | Which Actorium server to connect to (`production` by default) |

## License

MIT
