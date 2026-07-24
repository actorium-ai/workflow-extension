.PHONY: install build test lint typecheck format format-check clean \
	vscode-build vscode-watch vscode-package vscode-run

install:
	pnpm install

build:
	pnpm run build

test:
	pnpm run test

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

format:
	pnpm run format

format-check:
	pnpm run format:check

clean:
	rm -rf packages/vscode/dist shared/dist

vscode-build:
	pnpm --filter actorium-vscode run build

vscode-watch:
	pnpm --filter actorium-vscode run watch

vscode-package: vscode-build
	pnpm --filter actorium-vscode exec vsce package --no-dependencies

vscode-run: vscode-build
	code --extensionDevelopmentPath=$(CURDIR)/packages/vscode