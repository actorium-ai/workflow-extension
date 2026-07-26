import { useCallback, useEffect, useState } from 'react';

import type {
  AgentStatuses,
  AgentTarget,
  FeatureSummary,
  LinkedRepo,
  McpCliStatus,
  MeUser,
  StorageDocument,
  VersionEntry,
} from '../utils/types.ts';
import { getVsCodeApi } from '../utils/vscode-api.ts';

const vscode = getVsCodeApi();

export function useNavigatorController() {
  const [isConnected, setIsConnected] = useState(false);
  const [workspaceLabel, setWorkspaceLabel] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<MeUser | null>(null);
  const [docs, setDocs] = useState<StorageDocument[]>([]);
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [versionBlocked, setVersionBlocked] = useState<VersionEntry | null>(null);
  const [repos, setRepos] = useState<LinkedRepo[]>([]);
  const [hasWorkspaceFolder, setHasWorkspaceFolder] = useState(false);
  const [mcpStatuses, setMcpStatuses] = useState<AgentStatuses>({});
  const [pendingAgents, setPendingAgents] = useState<Set<AgentTarget>>(new Set());
  const [mcpCliStatus, setMcpCliStatus] = useState<McpCliStatus | null>(null);
  const [mcpCliInstalling, setMcpCliInstalling] = useState(false);

  const connect = useCallback(() => vscode.postMessage({ command: 'connect' }), []);
  const switchWorkspace = useCallback(() => vscode.postMessage({ command: 'switchWorkspace' }), []);
  const signOut = useCallback(() => vscode.postMessage({ command: 'signOut' }), []);
  const openProfileSettings = useCallback(
    () => vscode.postMessage({ command: 'openProfileSettings' }),
    [],
  );

  const requestDocs = useCallback(() => vscode.postMessage({ command: 'listDocs' }), []);
  const requestFeatures = useCallback(() => vscode.postMessage({ command: 'listFeatures' }), []);
  const requestRepos = useCallback(() => vscode.postMessage({ command: 'listRepos' }), []);
  const addRepo = useCallback(() => vscode.postMessage({ command: 'addRepo' }), []);
  const openWorkspaceFolder = useCallback(
    () => vscode.postMessage({ command: 'openWorkspaceFolder' }),
    [],
  );
  const requestMcpStatus = useCallback(() => vscode.postMessage({ command: 'listMcpStatus' }), []);
  const connectAgent = useCallback((target: AgentTarget) => {
    setPendingAgents((prev) => new Set(prev).add(target));
    vscode.postMessage({ command: 'connectAgent', target });
  }, []);
  const disconnectAgent = useCallback((target: AgentTarget) => {
    setPendingAgents((prev) => new Set(prev).add(target));
    vscode.postMessage({ command: 'disconnectAgent', target });
  }, []);
  const requestMcpCliStatus = useCallback(
    () => vscode.postMessage({ command: 'getMcpCliStatus' }),
    [],
  );
  const installMcpCli = useCallback(() => {
    setMcpCliInstalling(true);
    vscode.postMessage({ command: 'installMcpCli' });
  }, []);

  const openDocument = useCallback(
    (doc: StorageDocument) => vscode.postMessage({ command: 'openDocument', doc }),
    [],
  );
  const openFeatureDetail = useCallback(
    (feature: FeatureSummary) => vscode.postMessage({ command: 'openFeatureDetail', feature }),
    [],
  );
  const openFeaturesBrowser = useCallback(
    () => vscode.postMessage({ command: 'openFeaturesBrowser' }),
    [],
  );
  const tagInPrompt = useCallback(
    (text: string) => vscode.postMessage({ command: 'tagInPrompt', text }),
    [],
  );
  const openMarketplace = useCallback(() => {
    if (versionBlocked)
      vscode.postMessage({ command: 'openMarketplace', url: versionBlocked.marketplace_url });
  }, [versionBlocked]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.command) {
        case 'connectionChanged':
          setIsConnected(!!msg.connected);
          break;
        case 'workspaceLabelChanged':
          setWorkspaceLabel(msg.label ?? null);
          break;
        case 'userProfileChanged':
          setUserProfile(msg.profile ?? null);
          break;
        case 'docsLoaded':
          setDocs(msg.docs || []);
          break;
        case 'featuresLoaded':
          setFeatures(msg.features || []);
          break;
        case 'versionBlocked':
          setVersionBlocked(msg.entry ?? null);
          break;
        case 'reposLoaded':
          setRepos(msg.repos || []);
          setHasWorkspaceFolder(!!msg.hasWorkspaceFolder);
          break;
        case 'mcpStatusLoaded':
          setMcpStatuses(msg.statuses || {});
          setPendingAgents(new Set());
          break;
        case 'mcpCliStatusLoaded':
          setMcpCliStatus(msg.status ?? null);
          setMcpCliInstalling(false);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Handshake — the extension owns connection/workspace truth, not whatever
  // these states default to.
  useEffect(() => {
    vscode.postMessage({ command: 'ready' });
  }, []);

  // Fetch each section once a workspace is available (initial ready sync AND
  // any later workspace switch) — no polling, docs/features are otherwise
  // refreshed by manually reopening the section for now.
  useEffect(() => {
    if (isConnected && workspaceLabel) {
      requestDocs();
      requestFeatures();
      requestRepos();
      requestMcpStatus();
      requestMcpCliStatus();
    }
  }, [
    isConnected,
    workspaceLabel,
    requestDocs,
    requestFeatures,
    requestRepos,
    requestMcpStatus,
    requestMcpCliStatus,
  ]);

  return {
    isConnected,
    workspaceLabel,
    userProfile,
    docs,
    features,
    connect,
    switchWorkspace,
    signOut,
    openProfileSettings,
    openDocument,
    openFeatureDetail,
    openFeaturesBrowser,
    tagInPrompt,
    versionBlocked,
    openMarketplace,
    repos,
    hasWorkspaceFolder,
    addRepo,
    openWorkspaceFolder,
    mcpStatuses,
    pendingAgents,
    connectAgent,
    disconnectAgent,
    mcpCliStatus,
    mcpCliInstalling,
    installMcpCli,
  };
}

export type NavigatorController = ReturnType<typeof useNavigatorController>;
