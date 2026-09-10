import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AccountSummary,
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
  /** Display label for whichever backend this window is currently scoped
   * to — meaningful even before any account is signed in for it (see
   * AuthManager.getEnvironmentLabel), so the pre-connect AuthPrompt can say
   * which backend a "Connect" click is about to authenticate against. */
  const [environmentLabel, setEnvironmentLabel] = useState<string | null>(null);
  const [workspaceLabel, setWorkspaceLabel] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<MeUser | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [docs, setDocs] = useState<StorageDocument[]>([]);
  // True until the first docsLoaded message arrives (success or failure) —
  // set from the initial value, not from an effect, so requestDocs stays a
  // plain postMessage call safe to invoke from inside an effect (calling
  // setState synchronously in an effect body triggers cascading renders;
  // see react-hooks/set-state-in-effect). Never flips back to true after a
  // later refetch (account switch, Retry click) — those replace docs/
  // docsError directly without a loading flash.
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [featuresLoading, setFeaturesLoading] = useState(true);
  const [featuresError, setFeaturesError] = useState<string | null>(null);
  const [versionBlocked, setVersionBlocked] = useState<VersionEntry | null>(null);
  const [repos, setRepos] = useState<LinkedRepo[]>([]);
  const [hasWorkspaceFolder, setHasWorkspaceFolder] = useState(false);
  const [mcpStatuses, setMcpStatuses] = useState<AgentStatuses>({});
  const [pendingAgents, setPendingAgents] = useState<Set<AgentTarget>>(new Set());
  const [mcpCliStatus, setMcpCliStatus] = useState<McpCliStatus | null>(null);
  const [mcpCliInstalling, setMcpCliInstalling] = useState(false);
  const [cloningAll, setCloningAll] = useState(false);
  const [pullingAll, setPullingAll] = useState(false);
  const [checkingOutDefaultBranches, setCheckingOutDefaultBranches] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [pullingRepos, setPullingRepos] = useState<Set<string>>(new Set());
  const [checkingOutFeatures, setCheckingOutFeatures] = useState<Set<string>>(new Set());
  const [technicalSkillsStatuses, setTechnicalSkillsStatuses] = useState<TechnicalSkillsStatuses>(
    {},
  );
  const [technicalSkillsInstalling, setTechnicalSkillsInstalling] = useState<Set<AgentTarget>>(
    new Set(),
  );
  // Bumped by the extension host whenever it rewrites an already-registered
  // agent's MCP config after an account/workspace/environment switch (see
  // panel.ts's setMcpConfigUpdatedAt) — used only to trigger the refetch
  // effect below, never rendered directly.
  const [mcpConfigUpdatedAt, setMcpConfigUpdatedAt] = useState<number | null>(null);

  const connect = useCallback(() => vscode.postMessage({ command: 'connect' }), []);
  const switchWorkspace = useCallback(() => vscode.postMessage({ command: 'switchWorkspace' }), []);
  const signOut = useCallback(() => vscode.postMessage({ command: 'signOut' }), []);
  const openProfileSettings = useCallback(
    () => vscode.postMessage({ command: 'openProfileSettings' }),
    [],
  );
  const switchAccount = useCallback(
    (accountId: string) => vscode.postMessage({ command: 'switchAccount', accountId }),
    [],
  );
  const addAccount = useCallback(() => vscode.postMessage({ command: 'addAccount' }), []);
  const reconnectAccount = useCallback(
    () => vscode.postMessage({ command: 'reconnectAccount' }),
    [],
  );
  const reload = useCallback(() => vscode.postMessage({ command: 'reload' }), []);

  const requestDocs = useCallback(() => vscode.postMessage({ command: 'listDocs' }), []);
  const requestFeatures = useCallback(() => vscode.postMessage({ command: 'listFeatures' }), []);
  const requestRepos = useCallback(() => vscode.postMessage({ command: 'listRepos' }), []);
  const addRepo = useCallback(() => vscode.postMessage({ command: 'addRepo' }), []);
  const unlinkRepo = useCallback(
    (name: string) => vscode.postMessage({ command: 'unlinkRepo', name }),
    [],
  );
  const pullRepo = useCallback((name: string) => {
    setPullingRepos((prev) => new Set(prev).add(name));
    vscode.postMessage({ command: 'pullRepo', name });
  }, []);
  /** Shows a native QuickPick of every local/remote branch for this repo
   * (see panel.ts's _switchRepoBranch) — a searchable list is the better
   * fit for "pick one of possibly many branches" than a webview dropdown
   * would be, unlike the feature context menu's small fixed action list. */
  const switchRepoBranch = useCallback(
    (name: string) => vscode.postMessage({ command: 'switchRepoBranch', name }),
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
  const pullAllRepos = useCallback(() => {
    setPullingAll(true);
    vscode.postMessage({ command: 'pullAllRepos' });
  }, []);
  const checkoutDefaultBranches = useCallback(() => {
    setCheckingOutDefaultBranches(true);
    vscode.postMessage({ command: 'checkoutDefaultBranches' });
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
  const checkoutHandoffPRs = useCallback((feature: FeatureSummary) => {
    setCheckingOutFeatures((prev) => new Set(prev).add(feature.id));
    vscode.postMessage({ command: 'checkoutHandoffPRs', feature });
  }, []);
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
          setEnvironmentLabel(msg.environmentLabel ?? null);
          break;
        case 'workspaceLabelChanged':
          setWorkspaceLabel(msg.label ?? null);
          break;
        case 'userProfileChanged':
          setUserProfile(msg.profile ?? null);
          break;
        case 'accountsChanged':
          setAccounts(msg.accounts || []);
          break;
        case 'sessionExpiredChanged':
          setSessionExpired(!!msg.expired);
          break;
        case 'docsLoaded':
          setDocs(msg.docs || []);
          setDocsError(msg.error ?? null);
          setDocsLoading(false);
          break;
        case 'featuresLoaded':
          setFeatures(msg.features || []);
          setFeaturesError(msg.error ?? null);
          setFeaturesLoading(false);
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
        case 'pullAllReposDone':
          setPullingAll(false);
          break;
        case 'checkoutDefaultBranchesDone':
          setCheckingOutDefaultBranches(false);
          break;
        case 'pullRepoDone':
          setPullingRepos((prev) => {
            const next = new Set(prev);
            next.delete(msg.name);
            return next;
          });
          break;
        case 'checkoutHandoffPRsDone':
          setCheckingOutFeatures((prev) => {
            const next = new Set(prev);
            next.delete(msg.featureId);
            return next;
          });
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
        case 'mcpConfigUpdated':
          setMcpConfigUpdatedAt(msg.updatedAt ?? Date.now());
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

  const activeAccountId = accounts.find((a) => a.isActive)?.id ?? null;

  // Fetch each section once a workspace is available (initial ready sync AND
  // any later workspace switch). Docs/features are also kept fresh after
  // this by the extension host itself (NavigatorPanelProvider's visibility
  // listener + poll interval, panel.ts) re-pushing docsLoaded/featuresLoaded
  // without this effect re-running.
  //
  // activeAccountId is also a dependency: switching accounts without a
  // workspace-label change (e.g. two accounts on the same backend that
  // happen to share a workspace, or switching before a folder-local
  // workspaceLabel is restored) must still re-fetch MCP/docs/features status
  // for the newly-active account rather than silently keeping whatever the
  // previous account's session last returned.
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
    activeAccountId,
    requestDocs,
    requestFeatures,
    requestRepos,
    requestMcpStatus,
    requestMcpCliStatus,
    requestTechnicalSkillsStatus,
  ]);

  // A session that just recovered from expired may have had earlier
  // fetches silently fail (or return stale-but-successful data) while
  // expired — re-sync the sections most likely to have gone stale the
  // moment the session becomes valid again, rather than waiting for the
  // user to trigger some other refetch.
  const prevSessionExpired = useRef(sessionExpired);
  useEffect(() => {
    if (prevSessionExpired.current && !sessionExpired && isConnected && workspaceLabel) {
      requestMcpStatus();
      requestDocs();
      requestFeatures();
    }
    prevSessionExpired.current = sessionExpired;
  }, [sessionExpired, isConnected, workspaceLabel, requestMcpStatus, requestDocs, requestFeatures]);

  // The extension host rewrote an already-registered agent's MCP config
  // (see mcpConfigUpdated above) — refresh the agent-status list so a
  // stale/needs-restart badge appears without waiting for the next poll.
  useEffect(() => {
    if (mcpConfigUpdatedAt !== null) requestMcpStatus();
  }, [mcpConfigUpdatedAt, requestMcpStatus]);

  return {
    isConnected,
    environmentLabel,
    workspaceLabel,
    userProfile,
    accounts,
    sessionExpired,
    docs,
    docsLoading,
    docsError,
    requestDocs,
    features,
    featuresLoading,
    featuresError,
    requestFeatures,
    connect,
    switchWorkspace,
    signOut,
    openProfileSettings,
    switchAccount,
    addAccount,
    reconnectAccount,
    reload,
    openDocument,
    openFeatureDetail,
    checkoutHandoffPRs,
    checkingOutFeatures,
    openFeaturesBrowser,
    tagInPrompt,
    versionBlocked,
    openMarketplace,
    repos,
    hasWorkspaceFolder,
    addRepo,
    unlinkRepo,
    pullRepo,
    pullingRepos,
    switchRepoBranch,
    cloneRepo,
    cloneAllRepos,
    cloningAll,
    pullAllRepos,
    pullingAll,
    checkoutDefaultBranches,
    checkingOutDefaultBranches,
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
