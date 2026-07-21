import * as vscode from 'vscode';
import type { OperationalMode, CreditInfo } from '@workflow-extension/shared';
import type { ModeGate } from '../mode/gate.js';

/**
 * Chat panel provider — manages the sidebar webview for the Hermes chat.
 *
 * The webview renders:
 * - Message list (user on right, agent on left)
 * - Diff cards in Ask mode
 * - Mode selector (Ask / Plan / Auto)
 * - Mention autocomplete (#, //, @)
 * - Connection/auth prompt
 */
export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;
  private _connected = false;
  private _mode: OperationalMode = 'ask';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly modeGate: ModeGate,
    private readonly onSendMessage: (message: string, mode: OperationalMode) => Promise<void>,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview')],
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'sendMessage':
          await this.onSendMessage(message.text, this._mode);
          break;

        case 'setMode':
          this._mode = message.mode;
          this.modeGate.setMode(message.mode);
          this._postMessage({ command: 'modeChanged', mode: this._mode });
          break;

        case 'approveEdit':
          // The approval comes through the mode gate's handle method
          // This is handled in extension.ts via the deferred callback
          break;

        case 'rejectEdit':
          // Rejection is handled in extension.ts
          break;

        case 'connect':
          vscode.commands.executeCommand('hermes.connect');
          break;

        case 'getMentions':
          this._handleMentionAutocomplete(message);
          break;
      }
    });
  }

  /**
   * Update the connection state in the webview.
   */
  setConnected(connected: boolean): void {
    this._connected = connected;
    this._postMessage({ command: 'connectionChanged', connected });
  }

  /**
   * Show the auth prompt in the webview.
   */
  showAuthPrompt(): void {
    this._postMessage({ command: 'showAuthPrompt' });
  }

  /**
   * Set the operational mode in the webview UI.
   */
  setMode(mode: OperationalMode): void {
    this._mode = mode;
    this._postMessage({ command: 'modeChanged', mode });
  }

  /**
   * Append streaming text to the agent's response in the webview.
   */
  appendText(text: string): void {
    this._postMessage({ command: 'appendText', text });
  }

  /**
   * Send a tool progress update to the webview.
   */
  sendProgress(toolCallId: string, status: string): void {
    this._postMessage({ command: 'toolProgress', toolCallId, status });
  }

  /**
   * Clear the chat in the webview.
   */
  clearChat(): void {
    this._postMessage({ command: 'clearChat' });
  }

  /**
   * Post a message to the webview.
   */
  private _postMessage(message: Record<string, unknown>): void {
    this._view?.webview.postMessage(message);
  }

  /**
   * Handle mention autocomplete requests from the webview.
   */
  private async _handleMentionAutocomplete(message: {
    prefix: string;
    query: string;
  }): Promise<void> {
    const { prefix, query } = message;
    let items: Array<{ label: string; description: string }> = [];

    switch (prefix) {
      case '@': {
        // Local file search via VS Code workspace.findFiles
        const pattern = query ? `**/*${query}*` : '**/*';
        const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 20);
        items = uris.map((uri) => {
          const relativePath = vscode.workspace.asRelativePath(uri);
          return { label: relativePath, description: 'File' };
        });
        break;
      }

      case '#': {
        // Storage-service documents — placeholder (needs storage-service API)
        items = [
          { label: 'CLAUDE.md', description: 'Workspace document' },
          { label: 'README.md', description: 'Workspace document' },
        ];
        break;
      }

      case '//': {
        // Feature tags — placeholder (needs workflow-backend API)
        items = [{ label: '// No features available', description: 'Connect to a workspace' }];
        break;
      }
    }

    this._postMessage({ command: 'mentionResults', items });
  }

  /**
   * Generate the webview HTML content.
   */
  private _getHtmlContent(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hermes Chat</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --button-bg: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --button-hover: var(--vscode-button-hoverBackground);
      --user-msg-bg: var(--vscode-textBlockQuote-background);
      --agent-msg-bg: transparent;
      --accent: var(--vscode-focusBorder);
      --error: var(--vscode-errorForeground);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* ── Auth prompt ─────────────────────────────── */
    #authPrompt {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
      padding: 24px;
      text-align: center;
    }
    #authPrompt.hidden { display: none; }
    #authPrompt button {
      padding: 8px 24px;
      background: var(--button-bg);
      color: var(--button-fg);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    #authPrompt button:hover { background: var(--button-hover); }

    /* ── Header + mode selector ──────────────────── */
    #header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    #header.hidden { display: none; }
    #modeSelector {
      display: flex;
      gap: 2px;
      background: var(--input-bg);
      border-radius: 4px;
      padding: 2px;
    }
    .mode-btn {
      padding: 4px 12px;
      background: transparent;
      color: var(--fg);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      opacity: 0.7;
    }
    .mode-btn.active { background: var(--button-bg); color: var(--button-fg); opacity: 1; }
    .mode-btn:hover { background: var(--button-hover); opacity: 1; }

    /* ── Messages ────────────────────────────────── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #messages.hidden { display: none; }

    .message {
      max-width: 85%;
      padding: 8px 12px;
      border-radius: 8px;
      word-wrap: break-word;
      white-space: pre-wrap;
      line-height: 1.5;
    }
    .message.user { align-self: flex-end; background: var(--user-msg-bg); }
    .message.agent { align-self: flex-start; background: var(--agent-msg-bg); border: 1px solid var(--border); }
    .message.system { align-self: center; font-style: italic; opacity: 0.7; font-size: 0.9em; }

    /* ── Diff card ───────────────────────────────── */
    .diff-card {
      align-self: flex-start;
      max-width: 90%;
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      font-family: monospace;
      font-size: 0.9em;
    }
    .diff-header { font-size: 0.85em; opacity: 0.8; margin-bottom: 4px; }
    .diff-line { padding: 1px 4px; white-space: pre-wrap; }
    .diff-line.added { background: rgba(0, 255, 0, 0.1); color: #4ec944; }
    .diff-line.removed { background: rgba(255, 0, 0, 0.1); color: #e06c75; }
    .diff-actions { display: flex; gap: 8px; margin-top: 8px; }
    .diff-actions button {
      padding: 4px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .diff-actions .approve { background: #4ec944; color: #000; }
    .diff-actions .reject { background: var(--error); color: #fff; }

    /* ── Input area ──────────────────────────────── */
    #inputArea {
      padding: 8px 12px;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    #inputArea.hidden { display: none; }
    #inputContainer {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    #input {
      flex: 1;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      resize: none;
      min-height: 36px;
      max-height: 200px;
    }
    #input:focus { outline: 1px solid var(--accent); }
    #sendBtn {
      padding: 8px 16px;
      background: var(--button-bg);
      color: var(--button-fg);
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
    }
    #sendBtn:hover { background: var(--button-hover); }
    #sendBtn:disabled { opacity: 0.5; cursor: default; }

    /* ── Mention autocomplete ────────────────────── */
    #mentionDropdown {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      max-height: 200px;
      overflow-y: auto;
    }
    .mention-item {
      padding: 4px 12px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
    }
    .mention-item:hover, .mention-item.selected { background: var(--button-hover); }
    .mention-item .desc { opacity: 0.6; font-size: 0.85em; }
  </style>
</head>
<body>
  <div id="authPrompt">
    <h3>Hermes IDE Coding Agent</h3>
    <p>Connect to start pair programming with AI.</p>
    <button onclick="connect()">Connect to Hermes</button>
  </div>

  <div id="header" class="hidden">
    <strong>Hermes</strong>
    <div id="modeSelector">
      <button class="mode-btn active" data-mode="ask" onclick="setMode('ask')">Ask</button>
      <button class="mode-btn" data-mode="plan" onclick="setMode('plan')">Plan</button>
      <button class="mode-btn" data-mode="auto" onclick="setMode('auto')">Auto</button>
    </div>
  </div>

  <div id="messages" class="hidden"></div>

  <div id="inputArea" class="hidden">
    <div id="inputContainer" style="position: relative;">
      <textarea id="input" rows="1" placeholder="Ask Hermes... (use @ for files, # for docs, // for features)"></textarea>
      <div id="mentionDropdown"></div>
      <button id="sendBtn" onclick="sendMessage()">Send</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentMode = 'ask';
    let isConnected = false;

    // ── Connection state ────────────────────────────────────────
    function connect() {
      vscode.postMessage({ command: 'connect' });
    }

    // ── Mode selector ───────────────────────────────────────────
    function setMode(mode) {
      currentMode = mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
      vscode.postMessage({ command: 'setMode', mode });
    }

    // ── Send message ────────────────────────────────────────────
    function sendMessage() {
      const input = document.getElementById('input');
      const text = input.value.trim();
      if (!text) return;

      // Add user message to chat
      appendMessage('user', text);
      input.value = '';
      input.style.height = 'auto';

      // Add placeholder for agent response
      const agentMsg = appendMessage('agent', '');

      vscode.postMessage({ command: 'sendMessage', text, mode: currentMode });
    }

    // ── Append message ──────────────────────────────────────────
    function appendMessage(role, text) {
      const container = document.getElementById('messages');
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = text;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
      return div;
    }

    // ── Handle keyboard ─────────────────────────────────────────
    document.getElementById('input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
      // Auto-resize
      setTimeout(() => {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 200) + 'px';
      }, 0);
    });

    // ── Mention autocomplete ────────────────────────────────────
    const input = document.getElementById('input');
    const dropdown = document.getElementById('mentionDropdown');

    input.addEventListener('input', function() {
      const val = this.value;
      const cursorPos = this.selectionStart;
      const textBeforeCursor = val.substring(0, cursorPos);

      // Find the last mention trigger
      const match = textBeforeCursor.match(/([@#]|\\/\\/)\\S*$/);
      if (match) {
        const prefix = match[0].charAt(0) === '/' ? '//' : match[0].charAt(0);
        const query = match[0].substring(prefix.length);
        vscode.postMessage({ command: 'getMentions', prefix, query });
      } else {
        dropdown.style.display = 'none';
      }
    });

    // ── Message from extension ──────────────────────────────────
    window.addEventListener('message', function(event) {
      const msg = event.data;

      switch (msg.command) {
        case 'connectionChanged':
          isConnected = msg.connected;
          document.getElementById('authPrompt').classList.toggle('hidden', msg.connected);
          document.getElementById('header').classList.toggle('hidden', !msg.connected);
          document.getElementById('messages').classList.toggle('hidden', !msg.connected);
          document.getElementById('inputArea').classList.toggle('hidden', !msg.connected);
          break;

        case 'showAuthPrompt':
          document.getElementById('authPrompt').classList.remove('hidden');
          break;

        case 'modeChanged':
          currentMode = msg.mode;
          document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === msg.mode));
          appendMessage('system', 'Mode: ' + msg.mode.charAt(0).toUpperCase() + msg.mode.slice(1));
          break;

        case 'appendText':
          const msgs = document.getElementById('messages');
          const lastMsg = msgs.lastElementChild;
          if (lastMsg && lastMsg.classList.contains('agent')) {
            lastMsg.textContent += msg.text;
          } else {
            appendMessage('agent', msg.text);
          }
          msgs.scrollTop = msgs.scrollHeight;
          break;

        case 'toolProgress':
          appendMessage('system', 'Tool ' + msg.toolCallId + ': ' + msg.status);
          break;

        case 'clearChat':
          document.getElementById('messages').innerHTML = '';
          break;

        case 'mentionResults':
          if (msg.items && msg.items.length > 0) {
            dropdown.innerHTML = msg.items.map(function(item, i) {
              return '<div class="mention-item' + (i === 0 ? ' selected' : '') + '">' +
                '<span>' + item.label + '</span>' +
                '<span class="desc">' + item.description + '</span>' +
                '</div>';
            }).join('');
            dropdown.style.display = 'block';
          } else {
            dropdown.style.display = 'none';
          }
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}
