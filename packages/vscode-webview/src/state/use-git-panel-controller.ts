import { useCallback, useEffect, useState } from 'react';

import { getVsCodeApi } from '../utils/vscode-api.ts';

const vscode = getVsCodeApi();

export interface GitRepoOption {
  name: string;
  path: string;
}

export interface GitBranches {
  head?: string;
  local: string[];
  remote: string[];
}

export interface GitCommitEntry {
  hash: string;
  message: string;
  authorName?: string;
  authorDate?: string;
}

export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'other';

export interface GitChangedFile {
  path: string;
  status: GitChangeStatus;
}

/** Same postMessage/request-response shape as use-navigator-controller.ts —
 * see GitPanelProvider (extension host) for the command/message contract
 * this mirrors 1:1. */
export function useGitPanelController() {
  const [repos, setRepos] = useState<GitRepoOption[]>([]);
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);
  const [branches, setBranches] = useState<GitBranches>({ local: [], remote: [] });
  const [selectedRef, setSelectedRef] = useState<string | undefined>(undefined);
  const [commits, setCommits] = useState<GitCommitEntry[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(true);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<GitChangedFile[]>([]);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectRepo = useCallback((repoPath: string) => {
    setSelectedRepoPath(repoPath);
    setSelectedRef(undefined);
    setSelectedCommit(null);
    setCommitFiles([]);
    setCommitsLoading(true);
    vscode.postMessage({ command: 'selectGitRepo', path: repoPath });
  }, []);

  const selectRef = useCallback((ref: string | undefined) => {
    setSelectedRef(ref);
    setSelectedCommit(null);
    setCommitFiles([]);
    setCommitsLoading(true);
    vscode.postMessage({ command: 'listGitCommits', ref });
  }, []);

  const loadMoreCommits = useCallback(() => {
    setCommitsLoading(true);
    vscode.postMessage({ command: 'loadMoreGitCommits', ref: selectedRef });
  }, [selectedRef]);

  const selectCommit = useCallback((hash: string) => {
    setSelectedCommit((prev) => (prev === hash ? null : hash));
    setCommitFiles([]);
    vscode.postMessage({ command: 'getGitCommitDetails', hash });
  }, []);

  const pull = useCallback(() => {
    setPulling(true);
    vscode.postMessage({ command: 'gitPull' });
  }, []);

  const checkoutBranch = useCallback((branch: string) => {
    vscode.postMessage({ command: 'gitCheckout', branch });
  }, []);

  const showBranchContextMenu = useCallback((branch: string) => {
    vscode.postMessage({ command: 'showBranchContextMenu', branch });
  }, []);

  const refresh = useCallback(() => vscode.postMessage({ command: 'listGitRepos' }), []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.command) {
        case 'gitReposLoaded':
          setRepos(msg.repos || []);
          break;
        case 'gitBranchesLoaded':
          setBranches({ head: msg.head, local: msg.local || [], remote: msg.remote || [] });
          break;
        case 'gitCommitsLoaded':
          setCommits(msg.commits || []);
          setCommitsLoading(false);
          setError(null);
          break;
        case 'gitCommitDetailsLoaded':
          if (msg.hash === selectedCommit) setCommitFiles(msg.files || []);
          break;
        case 'gitActionDone':
          setPulling(false);
          setError(msg.ok ? null : (msg.message ?? null));
          break;
        case 'gitError':
          setCommitsLoading(false);
          setError(msg.message ?? null);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [selectedCommit]);

  useEffect(() => {
    vscode.postMessage({ command: 'ready' });
  }, []);

  return {
    repos,
    selectedRepoPath,
    selectRepo,
    branches,
    selectedRef,
    selectRef,
    commits,
    commitsLoading,
    loadMoreCommits,
    selectedCommit,
    selectCommit,
    commitFiles,
    pulling,
    pull,
    checkoutBranch,
    showBranchContextMenu,
    refresh,
    error,
  };
}

export type GitPanelController = ReturnType<typeof useGitPanelController>;
