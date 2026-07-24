import { useCallback, useEffect, useState } from 'react';

import type {
  FeatureSummary,
  MeUser,
  SessionSummary,
  StorageDocument,
  TaskSummary,
  VersionEntry,
} from '../utils/types.ts';
import { getVsCodeApi } from '../utils/vscode-api.ts';

const vscode = getVsCodeApi();

export function useNavigatorController() {
  const [isConnected, setIsConnected] = useState(false);
  const [workspaceLabel, setWorkspaceLabel] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<MeUser | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [docs, setDocs] = useState<StorageDocument[]>([]);
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [taskCache, setTaskCache] = useState<Record<string, TaskSummary[] | undefined>>({});
  const [versionBlocked, setVersionBlocked] = useState<VersionEntry | null>(null);

  const connect = useCallback(() => vscode.postMessage({ command: 'connect' }), []);
  const switchWorkspace = useCallback(() => vscode.postMessage({ command: 'switchWorkspace' }), []);
  const newChat = useCallback(() => vscode.postMessage({ command: 'newChat' }), []);
  const signOut = useCallback(() => vscode.postMessage({ command: 'signOut' }), []);
  const openProfileSettings = useCallback(
    () => vscode.postMessage({ command: 'openProfileSettings' }),
    [],
  );

  const requestSessions = useCallback(() => vscode.postMessage({ command: 'listSessions' }), []);
  const requestDocs = useCallback(() => vscode.postMessage({ command: 'listDocs' }), []);
  const requestFeatures = useCallback(() => vscode.postMessage({ command: 'listFeatures' }), []);
  const requestFeatureTasks = useCallback(
    (featureId: string) => vscode.postMessage({ command: 'listFeatureTasks', featureId }),
    [],
  );

  const loadSession = useCallback(
    (sessionId: string) => vscode.postMessage({ command: 'loadSession', sessionId }),
    [],
  );
  const deleteSession = useCallback(
    (sessionId: string) => vscode.postMessage({ command: 'deleteSession', sessionId }),
    [],
  );
  const insertMention = useCallback(
    (token: string) => vscode.postMessage({ command: 'insertMention', token }),
    [],
  );
  const openDocument = useCallback(
    (doc: StorageDocument) => vscode.postMessage({ command: 'openDocument', doc }),
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
        case 'sessionsLoaded':
          setSessions(msg.sessions || []);
          break;
        case 'docsLoaded':
          setDocs(msg.docs || []);
          break;
        case 'featuresLoaded':
          setFeatures(msg.features || []);
          break;
        case 'featureTasksLoaded':
          setTaskCache((prev) => ({ ...prev, [msg.featureId]: msg.tasks || [] }));
          break;
        case 'versionBlocked':
          setVersionBlocked(msg.entry ?? null);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Handshake, same idiom as the chat webview's controller — the extension
  // owns connection/workspace truth, not whatever these states default to.
  useEffect(() => {
    vscode.postMessage({ command: 'ready' });
  }, []);

  // Fetch each section once a workspace is available (initial ready sync AND
  // any later workspace switch) — no polling, sessions/docs/features are
  // otherwise refreshed by manually reopening the section for now.
  useEffect(() => {
    if (isConnected && workspaceLabel) {
      requestSessions();
      requestDocs();
      requestFeatures();
    }
  }, [isConnected, workspaceLabel, requestSessions, requestDocs, requestFeatures]);

  return {
    isConnected,
    workspaceLabel,
    userProfile,
    sessions,
    docs,
    features,
    taskCache,
    connect,
    switchWorkspace,
    newChat,
    signOut,
    openProfileSettings,
    loadSession,
    deleteSession,
    insertMention,
    requestFeatureTasks,
    openDocument,
    versionBlocked,
    openMarketplace,
  };
}

export type NavigatorController = ReturnType<typeof useNavigatorController>;
