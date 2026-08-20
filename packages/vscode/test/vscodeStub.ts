/**
 * A minimal in-memory stand-in for the `vscode` module, so extension modules
 * that import it can be unit-tested outside a real extension host.
 *
 * `vscode` has no runtime package on disk (only @types/vscode), so it can't
 * be resolved normally — installStub() intercepts the load instead. Any
 * module under test must therefore be `await import(...)`ed AFTER
 * installStub() runs, never imported at the top of a test file, or the real
 * (unresolvable) specifier is hit during hoisting.
 */

import Module from 'module';

/** The subset of ExtensionContext state this stub implements — enough for
 * anything that persists through globalState/workspaceState/secrets. */
export interface MemoryMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

function createMemento(): MemoryMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) store.delete(key);
      else store.set(key, value);
    },
  };
}

export interface SecretChange {
  key: string;
}

/** SecretStorage with a working onDidChange, since cross-window token
 * rotation is one of the behaviours worth testing. */
export function createSecrets() {
  const store = new Map<string, string>();
  const listeners = new Set<(e: SecretChange) => void>();
  const fire = (key: string) => {
    for (const listener of [...listeners]) listener({ key });
  };
  return {
    store_: store,
    async get(key: string): Promise<string | undefined> {
      return store.get(key);
    },
    async store(key: string, value: string): Promise<void> {
      store.set(key, value);
      fire(key);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
      fire(key);
    },
    onDidChange(listener: (e: SecretChange) => void) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}

/** Everything the stub recorded, so tests can assert on user-visible effects
 * (toasts, context keys) without a UI. */
export interface StubRecorder {
  info: string[];
  warnings: string[];
  errors: string[];
  commands: Array<{ command: string; args: unknown[] }>;
  opened: string[];
}

export function createVscodeStub(recorder: StubRecorder) {
  return {
    window: {
      showInformationMessage: (message: string, ...items: string[]) => {
        recorder.info.push(message);
        return Promise.resolve(items[0]);
      },
      showWarningMessage: (message: string, ...items: string[]) => {
        recorder.warnings.push(message);
        return Promise.resolve(undefined);
      },
      showErrorMessage: (message: string) => {
        recorder.errors.push(message);
        return Promise.resolve(undefined);
      },
      showQuickPick: () => Promise.resolve(undefined),
    },
    commands: {
      executeCommand: (command: string, ...args: unknown[]) => {
        recorder.commands.push({ command, args });
        return Promise.resolve(undefined);
      },
    },
    env: {
      openExternal: (uri: { toString(): string }) => {
        recorder.opened.push(uri.toString());
        return Promise.resolve(true);
      },
    },
    Uri: {
      parse: (value: string) => ({ toString: () => value }),
    },
    workspace: {
      // No settings.json in a test, so every actorium.* override is absent
      // and config resolution falls back to the selected environment.
      getConfiguration: () => ({ get: () => undefined }),
    },
    Disposable: class {
      readonly dispose: () => void;
      constructor(callOnDispose: () => void) {
        this.dispose = callOnDispose;
      }
    },
  };
}

export function newRecorder(): StubRecorder {
  return { info: [], warnings: [], errors: [], commands: [], opened: [] };
}

/**
 * Routes `require('vscode')` to the stub for the rest of the process.
 * Idempotent, and returns the recorder the stub writes to.
 */
export function installStub(): StubRecorder {
  const recorder = newRecorder();
  const stub = createVscodeStub(recorder);

  const loader = Module as unknown as { _load: (...args: any[]) => unknown };
  const original = loader._load;

  loader._load = function (request: string, ...rest: any[]) {
    if (request === 'vscode') return stub;
    return original.call(this, request, ...rest);
  };
  return recorder;
}

/** Builds an ExtensionContext-shaped object backed entirely by memory. */
export function createContext(secrets: ReturnType<typeof createSecrets>) {
  return {
    secrets,
    globalState: createMemento(),
    workspaceState: createMemento(),
    subscriptions: [] as Array<{ dispose(): void }>,
  };
}
