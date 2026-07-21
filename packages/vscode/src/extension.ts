import * as vscode from 'vscode';
import { AuthManager } from './auth/oauth.js';
import { ChatPanelProvider } from './chat/panel.js';
import { SseClient } from './chat/sse.js';
import { ToolExecutor } from './tools/executor.js';
import { ModeGate } from './mode/gate.js';
import { ContextGatherer } from './context/gatherer.js';
import { VersionChecker } from './version/checker.js';
import { CreditsStatusBar } from './status/credits.js';
import type { OperationalMode } from '@workflow-extension/shared';

let authManager: AuthManager;
let chatPanelProvider: ChatPanelProvider;
let sseClient: SseClient;
let toolExecutor: ToolExecutor;
let modeGate: ModeGate;
let contextGatherer: ContextGatherer;
let versionChecker: VersionChecker;
let creditsStatusBar: CreditsStatusBar;

export function activate(context: vscode.ExtensionContext): void {
  // ── 1. Initialize modules ───────────────────────────────────────────────
  authManager = new AuthManager(context);
  modeGate = new ModeGate();
  contextGatherer = new ContextGatherer();
  versionChecker = new VersionChecker(context);
  creditsStatusBar = new CreditsStatusBar(context);

  const defaultMode =
    vscode.workspace.getConfiguration('hermes').get<OperationalMode>('mode') ?? 'ask';

  toolExecutor = new ToolExecutor();

  sseClient = new SseClient(
    () => authManager.getToken(),
    () => vscode.workspace.getConfiguration('hermes').get<string>('agentUrl') ?? '',
  );

  // Wire SSE events to the mode gate → tool executor
  sseClient.onDeferredToolCall(async (deferred) => {
    const currentMode = modeGate.getMode();
    const result = await modeGate.handle(deferred, currentMode, toolExecutor);
    sseClient.sendToolResult(deferred.tool_call_id, deferred.tool, result);
  });

  sseClient.onProgress((toolCallId, status) => {
    chatPanelProvider?.sendProgress(toolCallId, status);
  });

  sseClient.onCost((creditInfo) => {
    creditsStatusBar.update(creditInfo);
  });

  // ── 2. Chat panel provider ──────────────────────────────────────────────
  chatPanelProvider = new ChatPanelProvider(
    context,
    modeGate,
    async (message: string, mode: OperationalMode) => {
      const token = await authManager.getToken();
      if (!token) {
        chatPanelProvider?.showAuthPrompt();
        return;
      }

      const ideContext = await contextGatherer.gather();
      const config = vscode.workspace.getConfiguration('hermes');
      const agentUrl = config.get<string>('agentUrl') ?? '';

      await sseClient.sendMessage(agentUrl, token, message, ideContext, mode, (text) =>
        chatPanelProvider?.appendText(text),
      );
    },
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('hermes.chatPanel', chatPanelProvider),
  );

  // ── 3. Commands ─────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('hermes.connect', () => authManager.startDeviceFlow()),
    vscode.commands.registerCommand('hermes.disconnect', () => authManager.disconnect()),
    vscode.commands.registerCommand('hermes.switchWorkspace', () => authManager.switchWorkspace()),
    vscode.commands.registerCommand('hermes.setMode', async () => {
      const picked = await vscode.window.showQuickPick(['ask', 'plan', 'auto'], {
        placeHolder: 'Select operational mode',
      });
      if (picked) {
        modeGate.setMode(picked as OperationalMode);
        chatPanelProvider?.setMode(picked as OperationalMode);
      }
    }),
    vscode.commands.registerCommand('hermes.checkVersion', () => versionChecker.checkNow()),
    vscode.commands.registerCommand('hermes.clearChat', () => chatPanelProvider?.clearChat()),
  );

  // ── 4. Connect on activation if token exists ────────────────────────────
  authManager.autoConnect().then((connected) => {
    if (connected) {
      chatPanelProvider?.setConnected(true);
    }
  });

  // ── 5. Version check ────────────────────────────────────────────────────
  versionChecker.autoCheck();

  // ── 6. Show credit status ───────────────────────────────────────────────
  creditsStatusBar.show();
}

export function deactivate(): void {
  sseClient?.dispose();
  versionChecker?.dispose();
  creditsStatusBar?.dispose();
}
