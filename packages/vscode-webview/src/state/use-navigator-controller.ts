import { useCallback, useEffect, useState } from 'react';

import type {
  AgentStatuses,
  AgentTarget,
  FeatureSummary,
  LinkedRepo,
  McpCliStatus,
  MeUser,
  StorageDocument,
  TechnicalSkillsStatuses,
  VersionEntry,
} from '../utils/types.ts';
import { getVsCodeApi } from '../utils/vscode-api.ts';

const vscode = getVsCodeApi();

const SKILLS_TARGETS: AgentTarget[] = ['claude', 'codex', 'opencode'];

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
  const [cloningAll, setCloningAll] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [technicalSkillsStatuses, setTechnicalSkillsStatuses] = useState<TechnicalSkillsStatuses>(
    {},
  );
  const [technicalSkillsInstalling, setTechnicalSkillsInstalling] = useState<Set<AgentTarget>>(
    new Set(),
  );

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
  const unlinkRepo = useCallback(
    (name: string) => vscode.postMessage({ command: 'unlinkRepo', name }),
    [],
  );
  /** The per-row "Clone" action on a known-but-unlinked workspace repo —
   * name passed explicitly so the clone lands under the repo's real name.
   * Errors surface via the extension host's own toast (see panel.ts's
   * _cloneRepo), so there's no local error/loading state to track here. */
  const cloneRepo = useCallback((url: string, name?: string) => {
    vscode.postMessage({ command: 'cloneRepo', url, name });
  }, []);
  const cloneAllRepos = useCallback(() => {
    setCloningAll(true);
    vscode.postMessage({ command: 'cloneAllRepos' });
  }, []);
  const repairWorkspace = useCallback(() => {
    setRepairing(true);
    vscode.postMessage({ command: 'repairWorkspace' });
  }, []);
  const unlinkWorkspaceFolder = useCallback(
    () => vscode.postMessage({ command: 'unlinkWorkspaceFolder' }),
    [],
  );
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
  const openAgentCli = useCallback(
    (target: AgentTarget) => vscode.postMessage({ command: 'openAgentCli', target }),
    [],
  );
  const requestMcpCliStatus = useCallback(
    () => vscode.postMessage({ command: 'getMcpCliStatus' }),
    [],
  );
  const installMcpCli = useCallback(() => {
    setMcpCliInstalling(true);
    vscode.postMessage({ command: 'installMcpCli' });
  }, []);
  const requestTechnicalSkillsStatus = useCallback(() => {
    for (const target of SKILLS_TARGETS) {
      vscode.postMessage({ command: 'getTechnicalSkillsStatus', target });
    }
  }, []);
  const installTechnicalSkills = useCallback((target: AgentTarget) => {
    setTechnicalSkillsInstalling((prev) => new Set(prev).add(target));
    vscode.postMessage({ command: 'installTechnicalSkills', target });
  }, []);
  const uninstallTechnicalSkills = useCallback((target: AgentTarget) => {
    setTechnicalSkillsInstalling((prev) => new Set(prev).add(target));
    vscode.postMessage({ command: 'uninstallTechnicalSkills', target });
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
        case 'cloneAllReposDone':
          setCloningAll(false);
          break;
        case 'repairWorkspaceDone':
          setRepairing(false);
          break;
        case 'technicalSkillsStatusLoaded':
          setTechnicalSkillsStatuses((prev) => ({ ...prev, [msg.target]: msg.status }));
          break;
        case 'technicalSkillsInstallDone':
          setTechnicalSkillsInstalling((prev) => {
            const next = new Set(prev);
            next.delete(msg.target);
            return next;
          });
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
  // any later workspace switch). Docs/features are also kept fresh after
  // this by the extension host itself (NavigatorPanelProvider's visibility
  // listener + poll interval, panel.ts) re-pushing docsLoaded/featuresLoaded
  // without this effect re-running.
  useEffect(() => {
    if (isConnected && workspaceLabel) {
      requestDocs();
      requestFeatures();
      requestRepos();
      requestMcpStatus();
      requestMcpCliStatus();
      requestTechnicalSkillsStatus();
    }
  }, [
    isConnected,
    workspaceLabel,
    requestDocs,
    requestFeatures,
    requestRepos,
    requestMcpStatus,
    requestMcpCliStatus,
    requestTechnicalSkillsStatus,
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
    unlinkRepo,
    cloneRepo,
    cloneAllRepos,
    cloningAll,
    repairWorkspace,
    repairing,
    unlinkWorkspaceFolder,
    openWorkspaceFolder,
    mcpStatuses,
    pendingAgents,
    connectAgent,
    disconnectAgent,
    openAgentCli,
    mcpCliStatus,
    mcpCliInstalling,
    installMcpCli,
    technicalSkillsStatuses,
    technicalSkillsInstalling,
    installTechnicalSkills,
    uninstallTechnicalSkills,
  };
}

export type NavigatorController = ReturnType<typeof useNavigatorController>;
