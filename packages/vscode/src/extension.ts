import type { ApprovalChoice, ModelOption, OperationalMode } from '@workflow-extension/shared';
import * as vscode from 'vscode';

import { AuthManager } from './auth/oauth.js';
import { type CodingApiContext, getSessionMessages } from './chat/coding-api';
import { type ActiveEditorContext, ChatPanelProvider, SELECTED_MODE_KEY } from './chat/panel.js';
import { SseClient } from './chat/sse.js';
import { getActoriumConfig } from './config/environment.js';
import { ContextGatherer } from './context/gatherer.js';
import { ModeGate } from './mode/gate.js';
import { ACTORIUM_DOC_SCHEME, DocContentProvider } from './navigator/doc-content-provider.js';
import { NavigatorPanelProvider } from './navigator/panel.js';
import { CreditsStatusBar } from './status/credits.js';
import { fetchUsage } from './status/usage.js';
import { ToolExecutor } from './tools/executor.js';
import { VersionChecker } from './version/checker.js';

const SELECTED_MODEL_KEY = 'actorium.selectedModel';
// Usage (daily/weekly quota) isn't pushed live the way credit balance is via
// SSE cost events — it has to be polled. 5 minutes matches this data's own
// staleness tolerance (digital-factory-ui's equivalent query uses a 30s
// staleTime for a foreground settings tab; a background status bar tooltip
// that's normally just hovered occasionally can afford to be coarser).
const USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let authManager: AuthManager;
let chatPanelProvider: ChatPanelProvider;
let navigatorProvider: NavigatorPanelProvider;
let sseClient: SseClient;
let toolExecutor: ToolExecutor;
let modeGate: ModeGate;
let contextGatherer: ContextGatherer;
let versionChecker: VersionChecker;
let creditsStatusBar: CreditsStatusBar;
let usageRefreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Fetch GET /api/me/usage and push the result into the status bar's hover
 * tooltip. Fails silently (fetchUsage itself never throws) — a stale or
 * missing usage card is a cosmetic gap, not worth surfacing as an error.
 */
async function refreshUsage(): Promise<void> {
  const token = await authManager.getToken();
  if (!token) return;
  const { userServiceUrl } = getActoriumConfig();
  const sections = await fetchUsage(userServiceUrl, token);
  creditsStatusBar?.updateUsage(sections, authManager.getOrgId());
}

/**
 * Snapshot the active editor's file + selection for the composer's context
 * chip — mirrors what ContextGatherer.gather() independently picks up on
 * every send (active_file/cursor_line/selection), just surfaced live so the
 * user can SEE what's about to be attached, the way Claude Code's own
 * composer shows a file/selection pill.
 */
function activeContextSnapshot(): ActiveEditorContext | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const sel = editor.selection;
  return {
    path: vscode.workspace.asRelativePath(editor.document.uri),
    selection: sel.isEmpty ? null : { startLine: sel.start.line + 1, endLine: sel.end.line + 1 },
  };
}

function pushActiveContext(): void {
  chatPanelProvider?.setActiveContext(activeContextSnapshot());
}

/**
 * Fetches a session's transcript, restores SseClient's own conversation state
 * (so the NEXT message continues this session with correct context), pushes
 * the turns into the chat webview, and reveals+focuses it in the secondary
 * sidebar. Shared by the navigator panel's Sessions section — the only
 * trigger for this now that session management lives entirely there.
 */
async function loadSessionIntoChat(sessionId: string): Promise<void> {
  const { agentUrl, workflowBackendUrl, storageServiceUrl } = getActoriumConfig();
  const messages = await getSessionMessages(
    { getToken: () => authManager.getToken(), agentUrl, workflowBackendUrl, storageServiceUrl },
    sessionId,
  );
  if (!messages) return;
  sseClient.setSessionId(sessionId);
  chatPanelProvider?.loadSessionIntoView(sessionId, messages);
  vscode.commands.executeCommand('actorium.chatPanel.focus');
}

interface AccountMenuItem extends vscode.QuickPickItem {
  action?: 'profile' | 'signout';
}

async function showAccountMenu(): Promise<void> {
  const token = await authManager.getToken();
  if (!token) {
    await authManager.startDeviceFlow();
    return;
  }

  const profile = authManager.getUserProfile();
  const name = profile?.display_name || profile?.email || 'Actorium account';

  const items: AccountMenuItem[] = [
    { label: '$(gear) Profile settings', action: 'profile' },
    { label: '$(sign-out) Sign out', action: 'signout' },
  ];

  const picked = await vscode.window.showQuickPick(items, { placeHolder: name });
  if (picked?.action === 'profile') {
    const { frontendUrl } = getActoriumConfig();
    vscode.env.openExternal(vscode.Uri.parse(`${frontendUrl}/settings/profile`));
  } else if (picked?.action === 'signout') {
    vscode.commands.executeCommand('actorium.disconnect');
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // ── 1. Initialize modules ───────────────────────────────────────────────
  authManager = new AuthManager(context);
  modeGate = new ModeGate();
  contextGatherer = new ContextGatherer();
  versionChecker = new VersionChecker(context);
  creditsStatusBar = new CreditsStatusBar(context);

  // The last mode the user actually picked (Ask/Plan/Auto) wins over the
  // actorium.mode SETTING's default — that setting is only ever consulted
  // the very first time, before anything has been cached. Mirrors
  // SELECTED_MODEL_KEY's identical precedence for the model picker below.
  const defaultMode =
    context.globalState.get<OperationalMode>(SELECTED_MODE_KEY) ??
    vscode.workspace.getConfiguration('actorium').get<OperationalMode>('mode') ??
    'ask';
  modeGate.setMode(defaultMode);

  toolExecutor = new ToolExecutor();

  // Resolved by the webview's inline approval card via the 'answerApproval'
  // postMessage below — the extension-host-internal analogue of clarify's
  // server-side wait, since Ask-mode approval never leaves the client.
  const pendingApprovals = new Map<
    string,
    (result: { choice: ApprovalChoice; instructions?: string }) => void
  >();
  const requestApproval = (
    callId: string,
    tool: string,
    params: Record<string, unknown>,
  ): Promise<{ choice: ApprovalChoice; instructions?: string }> => {
    return new Promise((resolve) => {
      pendingApprovals.set(callId, resolve);
      chatPanelProvider?.showApproval(callId, tool, params);
    });
  };

  sseClient = new SseClient(
    () => authManager.getToken(),
    () => getActoriumConfig().agentUrl,
    () => authManager.getWorkspaceId(),
  );

  // Wire SSE events to the mode gate → tool executor. A deferred tool call
  // already has a "running" entry in the panel's timeline (hermes-agent always
  // fires hermes.tool.progress{running} before hermes.tool.deferred for the
  // same call — see workflow-bff... err, hermes-agent's src/streaming/sse.py),
  // so completeToolCall here just attaches the IDE's local execution result.
  sseClient.onDeferredToolCall(async (deferred) => {
    // Attach params BEFORE executing (not just at completion) so the panel
    // can render "Read(file.py)"/"Bash(cmd)" etc. while the call is still
    // running — e.g. Ask mode's approval dialog can block here for a while.
    chatPanelProvider?.setToolParams(deferred.tool_call_id, deferred.params);
    const currentMode = modeGate.getMode();
    const result = await modeGate.handle(deferred, currentMode, toolExecutor, requestApproval);
    chatPanelProvider?.completeToolCall(deferred.tool_call_id, result);
    sseClient.sendToolResult(deferred.tool_call_id, result);
  });

  sseClient.onToolStart((callId, name) => {
    chatPanelProvider?.startToolCall(callId, name);
  });
  sseClient.onToolDone((callId) => {
    chatPanelProvider?.completeToolCall(callId);
  });

  sseClient.onReasoning((content) => {
    chatPanelProvider?.appendReasoning(content);
  });
  sseClient.onReasoningDone(() => {
    chatPanelProvider?.completeReasoning();
  });

  sseClient.onClarify((clarifyId, question, choices, multiple) => {
    chatPanelProvider?.showClarify(clarifyId, question, choices, multiple);
  });

  sseClient.onCost((creditInfo) => {
    creditsStatusBar.update(creditInfo);
  });

  // Fetch the selectable model catalog (GET /models) and resolve which
  // one is active: the persisted choice if it's still in the catalog,
  // otherwise the catalog's default, otherwise the first model. Fails open
  // (fetchModels() returns null on any error) — chat still works via the
  // server's env-var default model, just without a picker.
  const loadModels = async (): Promise<void> => {
    const response = await sseClient.fetchModels();
    if (!response) {
      return;
    }
    const persisted = context.globalState.get<string>(SELECTED_MODEL_KEY);
    const models: ModelOption[] = response.models;
    const selected =
      (persisted && models.some((m) => m.id === persisted) ? persisted : null) ??
      (response.default && models.some((m) => m.id === response.default)
        ? response.default
        : null) ??
      models[0]?.id ??
      '';
    sseClient.setModel(selected);
    chatPanelProvider?.setModels(models, selected);
  };

  // Keep the chat/navigator panels' UI in sync when a device-flow connection
  // completes (or is cleared) mid-session — autoConnect() below only covers
  // the token already being present at activation, not a fresh
  // connect/disconnect.
  authManager.onConnected(() => {
    chatPanelProvider?.setConnected(true);
    navigatorProvider?.setConnected(true);
    void loadModels();
    void refreshUsage();
    // First-time connect: send a message needs a real workspace_id (required,
    // non-nullable on the backend), so prompt for org → workspace right away
    // rather than waiting for the user to discover "Switch Workspace" or hit
    // the "no workspace" error on their first message.
    if (!authManager.getWorkspaceId()) {
      void authManager.switchWorkspace();
    }
  });
  authManager.onDisconnected(() => {
    chatPanelProvider?.setConnected(false);
    navigatorProvider?.setConnected(false);
    // "Switch account" is disconnect-then-connect-as-someone-else — clear
    // here so the panel starts empty once the new account finishes
    // connecting, instead of still showing the previous account's
    // conversation (the sidebar's own session list already reset on
    // disconnect; the chat panel's turns/session never did).
    sseClient?.clearMessages();
    modeGate?.resetSessionApproval();
    chatPanelProvider?.clearChat();
  });
  authManager.onWorkspaceChanged((label) => {
    navigatorProvider?.setWorkspaceLabel(label);
    // Usage is per-org, not per-workspace, but a workspace switch usually
    // means an org switch too — re-fetch so the status bar card reflects
    // whichever org is now active rather than the previous one.
    void refreshUsage();
    // The chat panel's sendMessage flow above always reads
    // authManager.getWorkspaceId() fresh per-message, so a workspace switch
    // takes effect on the OUTGOING side immediately with no further wiring —
    // but the panel's already-DISPLAYED turns/session are from the OLD
    // workspace and were never cleared, so switching workspace (or
    // reconnecting as a different account, which also fires this) left the
    // previous workspace's conversation visibly on screen even though the
    // sidebar's own session list had correctly reset. Full clearChat here
    // (same sequence as the "New chat" command) fixes both.
    sseClient?.clearMessages();
    modeGate?.resetSessionApproval();
    chatPanelProvider?.clearChat();
  });
  authManager.onProfileChanged((profile) => navigatorProvider?.setUserProfile(profile));

  // ── 2. Chat + navigator panel providers ─────────────────────────────────
  const codingApiCtx: CodingApiContext = {
    getToken: () => authManager.getToken(),
    getWorkspaceId: () => authManager.getWorkspaceId(),
  };

  // Constructed before ChatPanelProvider (rather than alongside
  // NavigatorPanelProvider below, where it used to live) — both panels now
  // need it: the navigator's Docs sidebar, and the chat panel's '#'
  // file-mention chip click-through (see navigator/open-document.ts's
  // openWorkspaceDocument, shared by both).
  const docContentProvider = new DocContentProvider();

  chatPanelProvider = new ChatPanelProvider(
    context,
    modeGate,
    async (message: string, imageIds?: string[]) => {
      // Defense in depth — the webview's own persistent block overlay
      // (setVersionBlocked) already prevents reaching this via the UI, but
      // guard the actual send path too in case a stale/already-open webview
      // still has an enabled composer from before the block was pushed.
      if (versionChecker.getBlockedEntry()) return;
      const token = await authManager.getToken();
      if (!token) {
        chatPanelProvider?.showAuthPrompt();
        return;
      }

      // Bracket the ENTIRE turn (including context gathering, not just the
      // SSE request) in setBusy(true)/finally-setBusy(false) with a catch-all
      // — previously an exception thrown before sseClient.sendMessage (e.g.
      // from contextGatherer.gather()) left the panel stuck showing an empty,
      // permanently non-busy turn with zero feedback. Any failure now always
      // surfaces as visible chat text.
      chatPanelProvider?.setBusy(true);
      try {
        const ideContext = await contextGatherer.gather();
        const agentUrl = getActoriumConfig().agentUrl;
        await sseClient.sendMessage(
          agentUrl,
          token,
          message,
          ideContext,
          (text) => chatPanelProvider?.appendText(text),
          imageIds,
        );
      } catch (err) {
        chatPanelProvider?.appendText(
          `\n\n⚠️ ${err instanceof Error ? err.message : String(err)}\n`,
        );
      } finally {
        chatPanelProvider?.setBusy(false);
      }
    },
    () => sseClient.cancel(),
    (modelId: string) => {
      sseClient.setModel(modelId);
      void context.globalState.update(SELECTED_MODEL_KEY, modelId);
    },
    codingApiCtx,
    (clarifyId: string, response: string) => {
      void sseClient.answerClarify(clarifyId, response);
    },
    (callId: string, choice: ApprovalChoice, instructions?: string) => {
      const resolve = pendingApprovals.get(callId);
      if (resolve) {
        pendingApprovals.delete(callId);
        resolve({ choice, instructions });
      }
    },
    docContentProvider,
  );
  chatPanelProvider.setMode(defaultMode);

  navigatorProvider = new NavigatorPanelProvider(
    context,
    codingApiCtx,
    loadSessionIntoChat,
    () => vscode.commands.executeCommand('actorium.clearChat'),
    docContentProvider,
    () => sseClient.getSessionId(),
  );
  navigatorProvider.setChatPanel(chatPanelProvider);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('actorium.chatPanel', chatPanelProvider),
    vscode.window.registerWebviewViewProvider('actorium.navigatorPanel', navigatorProvider),
    vscode.workspace.registerTextDocumentContentProvider(ACTORIUM_DOC_SCHEME, docContentProvider),
  );

  // ── 3. Commands ─────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('actorium.connect', () => authManager.startDeviceFlow()),
    vscode.commands.registerCommand('actorium.disconnect', () => authManager.disconnect()),
    vscode.commands.registerCommand('actorium.switchWorkspace', () =>
      authManager.switchWorkspace(),
    ),
    vscode.commands.registerCommand('actorium.setMode', async () => {
      const picked = await vscode.window.showQuickPick(['ask', 'plan', 'auto'], {
        placeHolder: 'Select operational mode',
      });
      if (picked) {
        modeGate.setMode(picked as OperationalMode);
        chatPanelProvider?.setMode(picked as OperationalMode);
        void context.globalState.update(SELECTED_MODE_KEY, picked);
      }
    }),
    vscode.commands.registerCommand('actorium.checkVersion', () => versionChecker.checkNow()),
    vscode.commands.registerCommand('actorium.showAccountMenu', () => showAccountMenu()),
    vscode.commands.registerCommand('actorium.clearChat', () => {
      // Also resets SseClient's own message history + session id — without
      // this, "New chat" only cleared the webview's displayed turns while
      // still silently resending the OLD conversation (and its session_id)
      // on the next message.
      sseClient.clearMessages();
      modeGate.resetSessionApproval();
      chatPanelProvider?.clearChat();
    }),
  );

  // ── 3b. URI handler — the device-authorize page in digital-factory-ui can
  // deep-link back here (vscode://<publisher>.<name>/connected) after the
  // user approves in the browser. The token itself never travels through
  // this URI (it's never put in a URL) — AuthManager's polling in
  // startDeviceFlow is what actually completes the connection; this handler
  // only brings the window into focus and gives immediate feedback instead
  // of waiting for the next poll tick.
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path === '/connected') {
          vscode.window.showInformationMessage(
            'Actorium: Authorization approved in browser — connecting…',
          );
        }
      },
    }),
  );

  // ── 4. Connect on activation if token exists ────────────────────────────
  authManager.autoConnect().then((connected) => {
    if (connected) {
      chatPanelProvider?.setConnected(true);
      navigatorProvider?.setConnected(true);
      // The workspace ID/label were already restored into authManager's
      // constructor from globalState, but nothing pushes that into the
      // navigator's own state (read by _syncState() on the webview's 'ready'
      // handshake) until a workspace change actually happens — without
      // this, a reload leaves the pill stuck on "Select workspace" even
      // though a real workspace is already selected and in use.
      navigatorProvider?.setWorkspaceLabel(authManager.getWorkspaceLabel());
      void loadModels();
      void refreshUsage();
    }
  });

  // ── 4a. Environment switch → logout + refresh ───────────────────────────
  // actorium.environment picks an entirely different server (different
  // bffUrl/clientId — see config/environment.ts's ENVIRONMENTS map), so a
  // token/workspace/org obtained under the OLD environment is meaningless
  // (at best rejected outright, at worst — if two environments happened to
  // share a compatible auth backend — silently pointed at the wrong org's
  // data). disconnect() clears the stored token/workspace/org and fires
  // onDisconnected, which already resets every panel's UI (chat/nav
  // connected state, transcript, mode-gate approvals) — the same "logout and
  // refresh" sequence as clicking Sign out, just triggered by the settings
  // change instead of a menu click. Deliberately does NOT auto-reconnect:
  // a different server means a real re-login, not a silent retry.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('actorium.environment')) {
        void authManager.disconnect();
      }
    }),
  );

  // ── 4b. Active editor/selection → composer context chip ─────────────────
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => pushActiveContext()),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) pushActiveContext();
    }),
  );
  pushActiveContext();

  // ── 5. Version check ────────────────────────────────────────────────────
  // Drives BOTH panels' persistent block overlay — each is a separate
  // webview (chat in the secondary sidebar, navigator in the primary one),
  // so neither can be left showing a usable composer/UI just because the
  // OTHER one happened to be open when the check ran.
  versionChecker.onBlocked((entry) => {
    chatPanelProvider?.setVersionBlocked(entry);
    navigatorProvider?.setVersionBlocked(entry);
  });
  versionChecker.autoCheck();

  // ── 6. Show credit status ───────────────────────────────────────────────
  creditsStatusBar.show();
  usageRefreshTimer = setInterval(() => void refreshUsage(), USAGE_REFRESH_INTERVAL_MS);
}

export function deactivate(): void {
  sseClient?.dispose();
  versionChecker?.dispose();
  creditsStatusBar?.dispose();
  if (usageRefreshTimer) clearInterval(usageRefreshTimer);
}
