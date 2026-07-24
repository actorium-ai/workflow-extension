# Actorium Agent

Agent-native delivery system, right inside VS Code.

Actorium connects your editor to your Actorium workspace: chat with the agent, browse and load past sessions, and jump straight to a workspace's docs and features — without leaving VS Code.

## Features

- **Chat** — talk to the Actorium agent from the secondary sidebar. Ask it to make changes, and control how much it checks with you first via `Ask` / `Plan` / `Auto` mode.
- **Navigator** — a primary-sidebar view listing your workspace's recent sessions, documents, and features. Click a session to reload it into chat; click a doc or feature to insert a reference (`#`/`//`) into your next message.
- **Workspaces** — connect your Actorium account and switch between workspaces directly from the editor.

## Getting started

1. Install the extension and open the Actorium icon in the activity bar.
2. Run **Actorium: Connect** (or click Connect in the sidebar) to sign in.
3. Select a workspace, then start chatting from the secondary sidebar.

## Commands

| Command | Description |
| --- | --- |
| `Actorium: Connect` | Sign in to your Actorium account |
| `Actorium: Disconnect` | Sign out |
| `Actorium: Switch Workspace` | Change the active workspace |
| `Actorium: Set Mode` | Choose how much the agent checks with you before making changes (`Ask` / `Plan` / `Auto`) |
| `Actorium: Clear Chat` | Start a new conversation |
| `Actorium: Check for Updates` | Check whether a newer extension version is available |
| `Actorium: Account` | Open the account menu |

## Settings

| Setting | Description |
| --- | --- |
| `actorium.environment` | Which Actorium server to connect to (`production` by default) |
| `actorium.mode` | How much the agent checks with you before making changes: `ask`, `plan`, or `auto` |

## License

MIT
