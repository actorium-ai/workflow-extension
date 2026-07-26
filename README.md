# workflow-extension

Actorium Agent — a VS Code extension that connects your editor to your Actorium workspace:
sign in, browse a workspace's docs and features, and keep a local multi-repo workspace folder
linked and documented (via a generated `AGENTS.md`) for local coding agents like Claude Code to
use. Actual coding happens in your own terminal agent — this extension doesn't run a chat of its
own; see the sibling `workflow-mcp` project for the MCP server that gives those agents live
feature/task/doc access, authenticated automatically once you're signed in here.

See [`packages/vscode/README.md`](packages/vscode/README.md) for the extension's own feature list, commands, and settings.

## Layout

This is a pnpm workspace with three packages:

| Package | Description |
| --- | --- |
| [`packages/vscode`](packages/vscode) | The VS Code extension itself — activation, auth, the workspace-folder/repo-linking flow, and the webview host |
| [`packages/vscode-webview`](packages/vscode-webview) | The React UI rendered inside the extension's Navigator webview |
| [`shared`](shared) | Types shared between the extension host and the webview |

## Development

```sh
make install       # pnpm install
make build          # build all packages
make typecheck       # typecheck all packages
make lint            # lint all packages
make test            # run all tests
make format          # format all packages
```

Extension-specific:

```sh
make vscode-build     # build just the extension + webview
make vscode-watch     # rebuild on change
make vscode-run       # launch an Extension Development Host with the built extension
make vscode-package   # produce a .vsix via vsce
```
