/**
 * Runtime-usable mirrors of two enums from the `vscode.git` extension's own
 * (unpublished) API — see `../types/git.d.ts`'s doc comment for why that file
 * exists. Declared here as REGULAR (non-const) enums, not in the ambient
 * `.d.ts` itself: `isolatedModules` (this package's tsconfig) explicitly
 * disallows referencing an ambient `const enum`'s members outside the file
 * that declares it, since a const enum needs full type info to inline and
 * isolatedModules requires every file to be transpilable independently. A
 * plain enum compiles to a real runtime object instead, so comparisons like
 * `ref.type === RefType.Head` work normally. The numeric values match the
 * real extension's own numbering exactly (Head=0, RemoteHead=1, Tag=2, and
 * Status's 19-value ordering) — these are NOT independently chosen, they
 * must stay in lockstep with what `vscode.git` actually returns.
 */

export enum RefType {
  Head = 0,
  RemoteHead = 1,
  Tag = 2,
}

export enum Status {
  INDEX_MODIFIED = 0,
  INDEX_ADDED = 1,
  INDEX_DELETED = 2,
  INDEX_RENAMED = 3,
  INDEX_COPIED = 4,
  MODIFIED = 5,
  DELETED = 6,
  UNTRACKED = 7,
  IGNORED = 8,
  INTENT_TO_ADD = 9,
  INTENT_TO_RENAME = 10,
  TYPE_CHANGED = 11,
  ADDED_BY_US = 12,
  ADDED_BY_THEM = 13,
  DELETED_BY_US = 14,
  DELETED_BY_THEM = 15,
  BOTH_ADDED = 16,
  BOTH_DELETED = 17,
  BOTH_MODIFIED = 18,
}
