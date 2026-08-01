import * as vscode from 'vscode';

export type ActoriumEnvironment = 'production' | 'local' | 'sw' | 'abp';

export interface EnvironmentDefaults {
  bffUrl: string;
  frontendUrl: string;
  clientId: string;
}
const USER_SERVICE_PATH = '/bff/user-service';
const HERMES_AGENT_PATH = '/bff/hermes-agent';
const WORKFLOW_BACKEND_PATH = '/bff/workflow-backend';
const STORAGE_SERVICE_PATH = '/bff/storage-service';

export const ENVIRONMENTS: Record<ActoriumEnvironment, EnvironmentDefaults> = {
  production: {
    bffUrl: 'https://api.actorium.ai',
    frontendUrl: 'https://app.actorium.ai',
    clientId: 'actorium-vscode',
  },
  abp: {
    bffUrl: 'https://workflow-backend-api.abp.vn',
    frontendUrl: 'https://workflow.abp.vn',
    clientId: 'actorium-vscode-abp',
  },
  sw: {
    bffUrl: 'https://workflow-backend-api.tempestdev.xyz',
    frontendUrl: 'https://workflow.tempestdev.xyz',
    clientId: 'actorium-vscode-sw',
  },
  local: {
    bffUrl: 'http://localhost:8090',
    frontendUrl: 'http://localhost:3000',
    clientId: 'actorium-vscode-local',
  },
};

export interface ActoriumConfig {
  environment: ActoriumEnvironment;
  bffUrl: string;
  frontendUrl: string;
  userServiceUrl: string;
  agentUrl: string;
  workflowBackendUrl: string;
  storageServiceUrl: string;
  clientId: string;
}

/** Derives the per-service BFF URLs from a bare bffUrl origin — factored out
 * of getActoriumConfig() so callers with an explicit bffUrl (an account that
 * isn't necessarily the globally-selected environment, e.g. AuthManager
 * acting on a non-active account, or workflow-api.ts's per-account data
 * fetches) can derive the same URLs without going through the
 * globally-selected environment/settings-override path below. */
export function deriveServiceUrls(bffUrl: string): {
  userServiceUrl: string;
  agentUrl: string;
  workflowBackendUrl: string;
  storageServiceUrl: string;
} {
  return {
    userServiceUrl: `${bffUrl}${USER_SERVICE_PATH}`,
    agentUrl: `${bffUrl}${HERMES_AGENT_PATH}`,
    workflowBackendUrl: `${bffUrl}${WORKFLOW_BACKEND_PATH}`,
    storageServiceUrl: `${bffUrl}${STORAGE_SERVICE_PATH}`,
  };
}

const SELECTED_ENVIRONMENT_KEY = 'actorium.selectedEnvironment';

let _context: vscode.ExtensionContext | undefined;

/**
 * Wires up the store backing getSelectedEnvironment()/setSelectedEnvironment()
 * below. Must be called once, early in activate(), before any of this
 * module's other exports are used.
 */
export function initEnvironmentStore(context: vscode.ExtensionContext): void {
  _context = context;
}

/**
 * The server the user picked at login (see selectServer() in extension.ts).
 * No longer a `actorium.environment` VS Code setting — this used to be
 * buried in Settings and easy to miss; it's now chosen as an explicit step
 * before the device flow starts, and persisted here (globalState, so it
 * carries over across windows/reloads the same way the old User-scope
 * setting did) rather than in settings.json.
 */
export function getSelectedEnvironment(): ActoriumEnvironment {
  return _context?.globalState.get<ActoriumEnvironment>(SELECTED_ENVIRONMENT_KEY) ?? 'production';
}

export async function setSelectedEnvironment(environment: ActoriumEnvironment): Promise<void> {
  await _context?.globalState.update(SELECTED_ENVIRONMENT_KEY, environment);
}

/**
 * Resolves effective config: explicit `actorium.*` settings win, otherwise
 * fall back to the defaults for the selected server (see
 * getSelectedEnvironment() above). userServiceUrl/agentUrl are derived from
 * the single bffUrl origin plus the BFF's upstream path prefixes, matching
 * digital-factory-ui's axios.ts (one bffBaseUrl + per-service /bff/<service>
 * prefix) rather than independently configurable URLs.
 */
export function getActoriumConfig(): ActoriumConfig {
  const config = vscode.workspace.getConfiguration('actorium');
  const environment = getSelectedEnvironment();
  const defaults = ENVIRONMENTS[environment] ?? ENVIRONMENTS.production;

  const bffUrl = config.get<string>('bffUrl') || defaults.bffUrl;

  return {
    environment,
    bffUrl,
    frontendUrl: config.get<string>('frontendUrl') || defaults.frontendUrl,
    ...deriveServiceUrls(bffUrl),
    clientId: config.get<string>('clientId') || defaults.clientId,
  };
}

/**
 * Resolves a specific environment's fixed defaults directly from
 * `ENVIRONMENTS`, ignoring any `actorium.bffUrl`/`frontendUrl`/`clientId`
 * settings.json override. Used only when adding a second (or later) account
 * via the account switcher's "Add another account" — those overrides only
 * make sense as "override the currently-selected environment," not as a
 * silent override of an explicitly-picked new account's backend.
 */
export function configForEnvironment(environment: ActoriumEnvironment): EnvironmentDefaults {
  return ENVIRONMENTS[environment] ?? ENVIRONMENTS.production;
}
