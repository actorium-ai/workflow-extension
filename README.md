# workflow-extension

Actorium Agent — a VS Code extension that connects your editor to your Actorium workspace: chat with the agent, browse past sessions, and jump to a workspace's docs and features without leaving VS Code.

See [`packages/vscode/README.md`](packages/vscode/README.md) for the extension's own feature list, commands, and settings.

## Layout

This is a pnpm workspace with three packages:

| Package | Description |
| --- | --- |
| [`packages/vscode`](packages/vscode) | The VS Code extension itself — activation, auth, and the webview host |
| [`packages/vscode-webview`](packages/vscode-webview) | The React UI rendered inside the extension's webviews (chat + navigator) |
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
