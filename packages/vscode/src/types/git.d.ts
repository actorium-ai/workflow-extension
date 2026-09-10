/**
 * Minimal hand-rolled subset of the built-in `vscode.git` extension's exported
 * API — Microsoft doesn't publish these types on npm (no `@types/vscode-git`
 * package exists), so extensions that consume this API vendor their own copy
 * of (a subset of) `git.d.ts` from the vscode repo's `extensions/git/src/api`.
 * Only the members actually used by `../git/gitApi.ts` and `../git/gitPanel.ts`
 * are declared here — extend as needed rather than pasting the full upstream
 * file, so this stays obviously in sync with what this extension depends on.
 *
 * `RefType`/`Status` are NOT declared here — see `../git/refTypes.ts` for why
 * (isolatedModules forbids using an ambient const enum's members outside this
 * file; a plain enum in a regular .ts file avoids that entirely and is
 * imported here as a type only).
 */
import type { Event, Uri } from 'vscode';

import type { RefType, Status } from '../git/refTypes.js';

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;
}

export interface Ref {
  readonly type: RefType;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export interface UpstreamRef {
  readonly remote: string;
  readonly name: string;
  readonly commit?: string;
}

export interface Branch extends Ref {
  readonly upstream?: UpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

export interface Commit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly commitDate?: Date;
}

export interface Change {
  readonly uri: Uri;
  readonly originalUri: Uri;
  readonly renameUri: Uri | undefined;
  readonly status: Status;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly refs: Ref[];
  readonly onDidChange: Event<void>;
}

export interface LogOptions {
  readonly ref?: string;
  readonly maxEntries?: number;
  readonly path?: string;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;

  status(): Promise<void>;
  checkout(treeish: string): Promise<void>;
  fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
  pull(unshallow?: boolean): Promise<void>;
  log(options?: LogOptions): Promise<Commit[]>;
  getCommit(ref: string): Promise<Commit>;
  diffBetween(ref1: string, ref2: string): Promise<Change[]>;
}

export interface API {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
  getRepository(uri: Uri): Repository | null;
}
