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

/**
 * Resolves effective config: explicit `actorium.*` settings win, otherwise
 * fall back to the defaults for the selected `actorium.environment`.
 * userServiceUrl/agentUrl are derived from the single bffUrl origin plus the
 * BFF's upstream path prefixes, matching digital-factory-ui's axios.ts
 * (one bffBaseUrl + per-service /bff/<service> prefix) rather than
 * independently configurable URLs.
 */
export function getActoriumConfig(): ActoriumConfig {
  const config = vscode.workspace.getConfiguration('actorium');
  const environment = config.get<ActoriumEnvironment>('environment') ?? 'production';
  const defaults = ENVIRONMENTS[environment] ?? ENVIRONMENTS.production;

  const bffUrl = config.get<string>('bffUrl') || defaults.bffUrl;

  return {
    environment,
    bffUrl,
    frontendUrl: config.get<string>('frontendUrl') || defaults.frontendUrl,
    userServiceUrl: `${bffUrl}${USER_SERVICE_PATH}`,
    agentUrl: `${bffUrl}${HERMES_AGENT_PATH}`,
    workflowBackendUrl: `${bffUrl}${WORKFLOW_BACKEND_PATH}`,
    storageServiceUrl: `${bffUrl}${STORAGE_SERVICE_PATH}`,
    clientId: config.get<string>('clientId') || defaults.clientId,
  };
}
