import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type {
  ActiveEditorContext,
  ApprovalChoice,
  ModelOption,
  OperationalMode,
  Turn,
  VersionEntry,
} from '../utils/types.ts';
import { getVsCodeApi } from '../utils/vscode-api.ts';
import {
  migrateTurn,
  nextTurnId,
  type PersistedChatState,
  seedTurnIdCounter,
  turnsReducer,
} from './turns-reducer.ts';
import { useMentionState } from './use-mention-state.ts';
import { usePendingImages } from './use-pending-images.ts';

const vscode = getVsCodeApi();

export function useChatController() {
  const [turns, dispatch] = useReducer(turnsReducer, undefined as unknown as Turn[], () => {
    const persisted = vscode.getState() as PersistedChatState | undefined;
    const restored = (persisted?.turns ?? []).map(migrateTurn);
    seedTurnIdCounter(restored.length);
    return restored;
  });
  const [mode, setModeState] = useState<OperationalMode>(() => {
    const persisted = vscode.getState() as PersistedChatState | undefined;
    return persisted?.mode ?? 'ask';
  });

  const [isConnected, setIsConnected] = useState(false);
  const [authPromptForced, setAuthPromptForced] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [loaderSeconds, setLoaderSeconds] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [activeContext, setActiveContext] = useState<ActiveEditorContext | null>(null);
  const [slashCommands, setSlashCommands] = useState<{ name: string; hint: string }[]>([]);
  const [featureNames, setFeatureNames] = useState<Record<string, string>>({});
  const [featureStages, setFeatureStages] = useState<Record<string, string>>({});
  const [versionBlocked, setVersionBlocked] = useState<VersionEntry | null>(null);
  const mentions = useMentionState();
  const images = usePendingImages();

  const currentTurnIdRef = useRef<string | null>(null);
  const messageQueueRef = useRef<{ text: string; imageIds: string[] }[]>([]);

  const ensureCurrentTurn = useCallback((): string => {
    if (!currentTurnIdRef.current) {
      const id = nextTurnId('a');
      currentTurnIdRef.current = id;
      dispatch({ type: 'addAssistant', id, now: Date.now() });
    }
    return currentTurnIdRef.current;
  }, []);

  // Persist chat history across the webview being hidden/shown and window
  // reloads. Connection/workspace/mode/busy truth is re-synced by the
  // extension on the 'ready' handshake below — only the transcript lives here.
  useEffect(() => {
    vscode.setState({ turns, mode });
  }, [turns, mode]);

  // Bouncing-dot loader's elapsed-seconds counter, live only while busy.
  // The reset-to-0 on an isBusy transition happens during render (React's own
  // "adjusting state when a prop changes" idiom — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // rather than as a synchronous setState call inside the effect below, so
  // the effect itself only ever calls setState from the interval's timer
  // callback (an actual external-system subscription, not a render echo).
  const [prevIsBusy, setPrevIsBusy] = useState(isBusy);
  if (isBusy !== prevIsBusy) {
    setPrevIsBusy(isBusy);
    setLoaderSeconds(0);
  }

  useEffect(() => {
    if (!isBusy) return;
    const id = setInterval(() => setLoaderSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isBusy]);

  const dispatchMessage = useCallback(
    (text: string, imageIds: string[] = []) => {
      dispatch({ type: 'addUser', id: nextTurnId('u'), text });
      const assistantId = nextTurnId('a');
      currentTurnIdRef.current = assistantId;
      dispatch({ type: 'addAssistant', id: assistantId, now: Date.now() });
      vscode.postMessage({ command: 'sendMessage', text, mode, imageIds });
    },
    [mode],
  );

  // Claude-Code-style type-ahead: a message submitted while the agent is
  // still busy isn't dropped or blocked — it's queued as a dimmed "Queued"
  // bubble and auto-dispatched the moment the current turn finishes.
  const sendMessage = useCallback(() => {
    const text = inputValue.trim();
    const imageIds = images.doneImageIds;
    if (!text && imageIds.length === 0) return;
    // A pasted image still mid-upload has no imageId yet — sending now would
    // silently drop it (doneImageIds only counts 'done' entries). Rare in
    // practice (uploads are fast) but wrong to send around rather than wait
    // for.
    if (images.hasUploading) return;
    setInputValue('');
    mentions.closeMentionDropdown();
    images.clear();

    if (isBusy) {
      messageQueueRef.current.push({ text, imageIds });
      dispatch({ type: 'addUser', id: nextTurnId('u'), text, queued: true });
      return;
    }
    dispatchMessage(text, imageIds);
  }, [inputValue, isBusy, dispatchMessage, mentions, images]);

  // The send button doubles as a stop button while busy: an empty input
  // means "stop the current turn"; non-empty input still queues via
  // sendMessage() above.
  const stopOrSend = useCallback(() => {
    if (isBusy && !inputValue.trim()) {
      vscode.postMessage({ command: 'stopTurn' });
      return;
    }
    sendMessage();
  }, [isBusy, inputValue, sendMessage]);

  const setMode = useCallback((m: OperationalMode) => {
    setModeState(m);
    vscode.postMessage({ command: 'setMode', mode: m });
  }, []);

  // Files dragged in from VS Code's own Explorer (text/uri-list, not this
  // webview's own text/plain sidebar-token payload — see input-bar.tsx's
  // handleDrop). Only the extension host can turn a dropped URI into a
  // workspace-relative <lf:path> tag (vscode.workspace.asRelativePath), so
  // this just forwards the raw URIs; panel.ts's resolveDroppedUris resolves
  // and inserts them back via the existing 'insertText' message.
  const dropFiles = useCallback(
    (uris: string[]) => vscode.postMessage({ command: 'resolveDroppedUris', uris }),
    [],
  );

  // Real tool catalog for the "+" actions menu's "Slash commands" section
  // (input-bar.tsx's ActionsMenu) — a dedicated round trip rather than
  // reusing the '/'-trigger mention dropdown's own state, so opening the
  // menu never fights with (or gets clobbered by) a live mention-dropdown
  // session. panel.ts's listSlashCommands case is the only place with a
  // bearer token to call GET /tools.
  const requestSlashCommands = useCallback(
    () => vscode.postMessage({ command: 'listSlashCommands' }),
    [],
  );

  // Feature id -> name, for markdown.tsx's doc-chip label (see
  // FeatureNamesContext) — fetched once per connection rather than per
  // message, since data-feature-id is a raw UUID by render time (mentions.ts
  // resolveMentions rewrites the slug before sending) and every doc chip
  // needs the same lookup.
  const requestFeatureNames = useCallback(
    () => vscode.postMessage({ command: 'listFeatureNames' }),
    [],
  );

  const connect = useCallback(() => vscode.postMessage({ command: 'connect' }), []);
  const clearChatClick = useCallback(() => vscode.postMessage({ command: 'clearChat' }), []);
  const openMarketplace = useCallback(() => {
    if (versionBlocked)
      vscode.postMessage({ command: 'openMarketplace', url: versionBlocked.marketplace_url });
  }, [versionBlocked]);

  const selectModel = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
    vscode.postMessage({ command: 'setModel', modelId });
  }, []);

  const toggleThinking = useCallback(
    (turnId: string) => dispatch({ type: 'toggleThinking', turnId }),
    [],
  );
  const toggleToolOutput = useCallback(
    (turnId: string, callId: string) => dispatch({ type: 'toggleToolOutput', turnId, callId }),
    [],
  );

  const submitClarifyAnswer = useCallback((turnId: string, clarifyId: string, answer: string) => {
    dispatch({ type: 'clarifyAnswered', turnId, clarifyId, answer });
    vscode.postMessage({ command: 'answerClarify', clarifyId, response: answer });
  }, []);

  const respondApproval = useCallback(
    (turnId: string, callId: string, choice: ApprovalChoice, instructions?: string) => {
      dispatch({ type: 'approvalAnswered', turnId, callId, choice });
      vscode.postMessage({ command: 'answerApproval', callId, choice, instructions });
    },
    [],
  );

  const handleExtensionMessage = useCallback(
    (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.command) {
        case 'connectionChanged':
          setIsConnected(!!msg.connected);
          setAuthPromptForced(false);
          if (msg.connected) requestFeatureNames();
          break;

        case 'showAuthPrompt':
          setAuthPromptForced(true);
          break;

        case 'busyChanged': {
          const busy = !!msg.busy;
          setIsBusy(busy);
          if (!busy) {
            const finishedTurnId = currentTurnIdRef.current;
            currentTurnIdRef.current = null;
            // A turn that ends with literally nothing (no text, no reasoning,
            // no tool calls) would otherwise render as nothing at all —
            // indistinguishable from the turn never having happened.
            if (finishedTurnId) {
              dispatch({ type: 'markNoResponse', turnId: finishedTurnId });
            }
            if (messageQueueRef.current.length > 0) {
              const next = messageQueueRef.current.shift()!;
              dispatch({ type: 'dequeueUser' });
              dispatchMessage(next.text, next.imageIds);
            }
          }
          break;
        }

        case 'modeChanged':
          setModeState(msg.mode);
          break;

        case 'modelsLoaded':
          setAvailableModels(msg.models || []);
          setSelectedModelId(msg.selected || '');
          break;

        case 'appendText': {
          const turnId = ensureCurrentTurn();
          dispatch({ type: 'appendText', turnId, text: msg.text });
          break;
        }

        case 'reasoning': {
          const turnId = ensureCurrentTurn();
          dispatch({ type: 'reasoning', turnId, content: msg.content });
          break;
        }

        case 'reasoningDone':
          if (currentTurnIdRef.current) {
            dispatch({ type: 'reasoningDone', turnId: currentTurnIdRef.current, now: Date.now() });
          }
          break;

        case 'toolStart': {
          const turnId = ensureCurrentTurn();
          dispatch({ type: 'toolStart', turnId, callId: msg.callId, name: msg.name });
          break;
        }

        case 'toolParams': {
          const turnId = ensureCurrentTurn();
          dispatch({ type: 'toolParams', turnId, callId: msg.callId, params: msg.params || {} });
          break;
        }

        case 'toolComplete': {
          const turnId = ensureCurrentTurn();
          dispatch({ type: 'toolComplete', turnId, callId: msg.callId, output: msg.output });
          break;
        }

        case 'clarify': {
          const turnId = ensureCurrentTurn();
          dispatch({
            type: 'clarify',
            turnId,
            clarifyId: msg.clarifyId,
            question: msg.question,
            choices: msg.choices ?? null,
            multiple: !!msg.multiple,
          });
          break;
        }

        case 'approval': {
          const turnId = ensureCurrentTurn();
          dispatch({
            type: 'approval',
            turnId,
            callId: msg.callId,
            tool: msg.tool,
            params: msg.params || {},
          });
          break;
        }

        case 'clearChat':
          currentTurnIdRef.current = null;
          messageQueueRef.current = [];
          dispatch({ type: 'clear' });
          break;

        case 'mentionResults':
          mentions.setResults(msg.items || []);
          break;

        case 'sessionLoaded':
          currentTurnIdRef.current = null;
          messageQueueRef.current = [];
          dispatch({ type: 'restore', turns: msg.turns || [] });
          break;

        case 'insertText':
          setInputValue((v) => (v ? `${v} ${msg.text}` : msg.text));
          break;

        case 'activeContextChanged':
          setActiveContext(msg.context ?? null);
          break;

        case 'slashCommandsLoaded':
          setSlashCommands(msg.commands || []);
          break;

        case 'featureNamesLoaded':
          setFeatureNames(msg.names || {});
          setFeatureStages(msg.stages || {});
          break;

        case 'imageUploaded':
          images.markUploaded(msg.localId, msg.imageId);
          break;

        case 'imageUploadFailed':
          images.markFailed(msg.localId);
          break;

        case 'versionBlocked':
          setVersionBlocked(msg.entry ?? null);
          break;
      }
    },
    [ensureCurrentTurn, dispatchMessage, mentions, images, requestFeatureNames],
  );

  useEffect(() => {
    window.addEventListener('message', handleExtensionMessage);
    return () => window.removeEventListener('message', handleExtensionMessage);
  }, [handleExtensionMessage]);

  // Handshake: tells the extension this webview is ready to receive the true
  // connection/workspace/mode/busy state (it owns that truth, not the
  // hardcoded defaults above) — matters for a webview recreated after being
  // hidden or after a window reload.
  useEffect(() => {
    vscode.postMessage({ command: 'ready' });
  }, []);

  return {
    turns,
    mode,
    isConnected,
    authPromptVisible: authPromptForced || !isConnected,
    isBusy,
    availableModels,
    selectedModelId,
    loaderSeconds,
    inputValue,
    setInputValue,
    activeContext,
    pendingImages: images.pendingImages,
    addPendingImage: images.addImage,
    removePendingImage: images.removeImage,
    dropFiles,
    slashCommands,
    requestSlashCommands,
    featureNames,
    featureStages,
    mentionItems: mentions.mentionItems,
    mentionSelectedIndex: mentions.mentionSelectedIndex,
    setMentionSelectedIndex: mentions.setMentionSelectedIndex,
    mentionActivePrefix: mentions.mentionActivePrefix,
    mentionMatchStart: mentions.mentionMatchStart,
    requestMentions: mentions.requestMentions,
    closeMentionDropdown: mentions.closeMentionDropdown,
    sendMessage,
    stopOrSend,
    setMode,
    connect,
    clearChatClick,
    selectModel,
    toggleThinking,
    toggleToolOutput,
    submitClarifyAnswer,
    respondApproval,
    versionBlocked,
    openMarketplace,
  };
}

export type ChatController = ReturnType<typeof useChatController>;
