import * as os from 'node:os';

import {
  type ApprovalChoice,
  buildMentionTag,
  type CreditInfo,
  type ModelOption,
  type OperationalMode,
  type SessionMessage,
  type VersionEntry,
} from '@workflow-extension/shared';
import * as vscode from 'vscode';

import type { ModeGate } from '../mode/gate.js';
import type { DocContentProvider } from '../navigator/doc-content-provider.js';
import { openWorkspaceDocument } from '../navigator/open-document.js';
import { buildWebviewHtml } from '../webview-html.js';
import {
  codingApiConfig,
  type CodingApiContext,
  listFeatures,
  listTools,
  uploadImage,
} from './coding-api';
import { buildMentionItems, resolveMentions } from './mentions.js';

export type { CodingApiContext } from './coding-api';

/** globalState key the last-picked operational mode is cached under — read
 * once at activation (extension.ts) to seed both ModeGate and this panel's
 * initial mode, so a fresh window/extension-host restart resumes whatever
 * mode was last picked instead of always resetting to Ask. Exported (not
 * just a module-local constant) so extension.ts's read and this file's own
 * write below agree on the exact same key. */
export const SELECTED_MODE_KEY = 'actorium.selectedMode';

/** Snapshot of the active editor, pushed to the webview so the composer can
 * show what context is about to be attached — mirrors Claude Code's own
 * composer chip ("8 lines selected"). Purely presentational: the actual
 * context sent to the agent is gathered independently, unconditionally, on
 * every send by ContextGatherer.gather() — this only shows the user what
 * that gather() call is ABOUT to pick up, so there's never a text-vs-fact
 * mismatch to keep in sync beyond "reads the same live editor state". */
export interface ActiveEditorContext {
  /** Workspace-relative path, or the basename if outside any workspace folder. */
  path: string;
  /** 1-based inclusive start/end line of the current selection, or null when
   * the selection is empty (just a caret, no highlighted range). */
  selection: { startLine: number; endLine: number } | null;
}

/**
 * Chat panel provider — manages the sidebar webview for the Actorium chat.
 *
 * The webview renders:
 * - Message list (user bubble on right, assistant plain text on left) with
 *   a hand-rolled markdown renderer + @/#/// mention chips (mirrors
 *   digital-factory-ui's message.tsx rendering) — clicking a `#` file chip
 *   opens the referenced document the same way the navigator's Docs sidebar
 *   does (see the 'openDocMention' case below, backed by
 *   navigator/open-document.ts's openWorkspaceDocument)
 * - Tool-call activity rows interleaved with text in the order they actually
 *   happened (spinner while running, per-tool icon + label once done,
 *   expandable raw output) — see utils/types.ts's AssistantSegment and
 *   components/tool-calls.tsx's ToolCallRow
 * - A reasoning/thinking disclosure that stays expanded live and collapses to
 *   "Thought for Ns" once the turn finishes — mirrors thinking-disclosure.tsx
 * - A clarify prompt (question + choice/free-text answer) at its actual
 *   position in the flow when the agent's `clarify` tool blocks the turn —
 *   mirrors digital-factory-ui's clarify-prompt.tsx
 * - A bouncing-dot + elapsed-seconds agent loader while a turn is in flight —
 *   mirrors loader.tsx
 * - Mode selector (Ask / Plan / Auto), mention autocomplete (#, //, @)
 * - Connection/auth prompt (the org/workspace switcher itself lives in the
 *   navigator panel now, in the primary sidebar)
 */
export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;
  private _connected = false;
  private _mode: OperationalMode = 'ask';
  private _busy = false;
  private _models: ModelOption[] = [];
  private _selectedModel = '';
  private _activeContext: ActiveEditorContext | null = null;
  private _versionBlockedEntry: VersionEntry | null = null;
  // Set when clearChat() is called before this webview has ever been
  // resolved (e.g. "New session" clicked from the navigator sidebar while
  // the chat view in the secondary sidebar has never been opened this
  // session) — _postMessage silently no-ops on a null _view, so without
  // this the clear is just lost: the panel later mounts for the first time,
  // reads its OWN stale vscode.getState() transcript, and shows it as if
  // nothing happened. Consumed (and cleared) on the next 'ready' handshake.
  private _pendingClear = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly modeGate: ModeGate,
    private readonly onSendMessage: (message: string, imageIds?: string[]) => Promise<void>,
    private readonly onStopTurn: () => void,
    private readonly onModelChange: (modelId: string) => void,
    private readonly codingApiCtx: CodingApiContext,
    private readonly onAnswerClarify: (clarifyId: string, response: string) => void,
    private readonly onAnswerApproval: (
      callId: string,
      choice: ApprovalChoice,
      instructions?: string,
    ) => void,
    private readonly docContentProvider: DocContentProvider,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist')],
    };

    webviewView.webview.html = buildWebviewHtml(this.context, webviewView.webview, 'chat');

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'sendMessage':
          await this.onSendMessage(
            await resolveMentions(message.text, this.codingApiCtx),
            message.imageIds,
          );
          break;

        case 'pasteImage': {
          const workspaceId = this.codingApiCtx.getWorkspaceId();
          const imageId = workspaceId
            ? await uploadImage(
                codingApiConfig(this.codingApiCtx),
                workspaceId,
                Buffer.from(message.dataBase64, 'base64'),
                message.mimeType,
              )
            : null;
          this._postMessage(
            imageId
              ? { command: 'imageUploaded', localId: message.localId, imageId }
              : { command: 'imageUploadFailed', localId: message.localId },
          );
          break;
        }

        case 'setMode':
          this._mode = message.mode;
          this.modeGate.setMode(message.mode);
          void this.context.globalState.update(SELECTED_MODE_KEY, message.mode);
          this._postMessage({ command: 'modeChanged', mode: this._mode });
          break;

        case 'connect':
          vscode.commands.executeCommand('actorium.connect');
          break;

        case 'clearChat':
          vscode.commands.executeCommand('actorium.clearChat');
          break;

        case 'stopTurn':
          this.onStopTurn();
          break;

        case 'setModel':
          this._selectedModel = message.modelId;
          this.onModelChange(message.modelId);
          break;

        case 'getMentions':
          void buildMentionItems(message.prefix, message.query, this.codingApiCtx).then((items) =>
            this._postMessage({ command: 'mentionResults', items }),
          );
          break;

        case 'answerClarify':
          this.onAnswerClarify(message.clarifyId, message.response);
          break;

        case 'answerApproval':
          this.onAnswerApproval(message.callId, message.choice, message.instructions);
          break;

        case 'openFile':
          await this._openFile(message.path);
          break;

        case 'resolveDroppedUris':
          this._resolveDroppedUris(message.uris);
          break;

        case 'listSlashCommands':
          void listTools(codingApiConfig(this.codingApiCtx)).then((tools) =>
            this._postMessage({
              command: 'slashCommandsLoaded',
              commands: (tools ?? [])
                .map((t) => ({ name: t.name.replace(/_/g, '-'), hint: t.description }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            }),
          );
          break;

        case 'listFeatureNames': {
          const workspaceId = this.codingApiCtx.getWorkspaceId();
          if (!workspaceId) break;
          void listFeatures(codingApiConfig(this.codingApiCtx), workspaceId).then((features) => {
            const names: Record<string, string> = {};
            // f.status (NOT f.current_stage — a separate, finer-grained field
            // only used as a next_action tooltip fallback elsewhere, e.g.
            // feature-list.tsx) holds the lifecycle-stage vocabulary
            // (backlog/in_design/in_tdd/.../done/blocked/cancelled — same
            // list as hermes-agent's own "## Feature lifecycle") that feeds
            // the feature chip's LifecycleGlyph (markdown.tsx's
            // SpanRenderer, mirrors digital-factory-ui's
            // FeatureMentionPill) — confirmed against feature-list.tsx's own
            // `<LifecycleGlyph stage={feature.status} />` usage.
            const stages: Record<string, string> = {};
            for (const f of features ?? []) {
              names[f.id] = f.feature_name;
              stages[f.id] = f.status;
            }
            this._postMessage({ command: 'featureNamesLoaded', names, stages });
          });
          break;
        }

        case 'openDocMention':
          // A `#` file-mention chip click (message.tsx's WORKSPACE_ROOT_FEATURE_ID
          // convention: featureId === '_workspace' means no owning feature).
          // Reuses the exact same open logic as the navigator's Docs sidebar
          // (local-checkout-first, storage-service fallback) — these are
          // workflow documents, not necessarily files that exist in this
          // window's local git checkout, so this must NOT go through
          // _openFile's plain vscode.workspace.openTextDocument path.
          // `id` only needs to be unique for the virtual-document URI /
          // temp-file naming below, never sent back to the server (see
          // getDocumentContent/getDocumentRaw's Pick<..., 'path'|'feature_id'>
          // signatures), so a synthesized value is fine here.
          await openWorkspaceDocument(
            {
              id: `${message.featureId}:${message.path}`,
              feature_id: message.featureId === '_workspace' ? null : message.featureId,
              path: message.path,
            },
            this.codingApiCtx,
            this.docContentProvider,
          );
          break;

        case 'openMarketplace':
          vscode.env.openExternal(vscode.Uri.parse(message.url));
          break;

        case 'ready':
          this._syncState();
          break;
      }
    });
  }

  /**
   * Re-send all extension-owned UI state to the (freshly resolved) webview.
   * Called on the 'ready' handshake so a webview recreated after being
   * hidden or after a window reload reflects the true connection/workspace/
   * mode/busy state instead of the HTML's hardcoded defaults.
   */
  private _syncState(): void {
    if (this._pendingClear) {
      this._pendingClear = false;
      this._postMessage({ command: 'clearChat' });
    }
    this._postMessage({ command: 'connectionChanged', connected: this._connected });
    this._postMessage({ command: 'modeChanged', mode: this._mode });
    this._postMessage({ command: 'busyChanged', busy: this._busy });
    if (this._models.length > 0) {
      this._postMessage({
        command: 'modelsLoaded',
        models: this._models,
        selected: this._selectedModel,
      });
    }
    this._postMessage({ command: 'activeContextChanged', context: this._activeContext });
    if (this._versionBlockedEntry) {
      this._postMessage({ command: 'versionBlocked', entry: this._versionBlockedEntry });
    }
  }

  /**
   * Push the active editor's file/selection to the composer's context chip
   * — called by extension.ts on every onDidChangeActiveTextEditor/
   * onDidChangeTextEditorSelection event. Purely presentational (see
   * ActiveEditorContext's own doc comment) — never touches what's actually
   * sent to the agent.
   */
  setActiveContext(ctx: ActiveEditorContext | null): void {
    this._activeContext = ctx;
    this._postMessage({ command: 'activeContextChanged', context: ctx });
  }

  /**
   * Populate the model picker in the webview's input toolbar. `models` is
   * the GET /models catalog (same model_catalog table the browser app's
   * picker reads); `selectedId` is which one starts selected.
   */
  setModels(models: ModelOption[], selectedId: string): void {
    this._models = models;
    this._selectedModel = selectedId;
    this._postMessage({ command: 'modelsLoaded', models, selected: selectedId });
  }

  /**
   * Shows a persistent, non-dismissible block overlay that replaces the
   * entire chat UI (header, transcript, composer — model/mode pickers and
   * send button included) until the extension is updated. Unlike the
   * VersionChecker's native showErrorMessage toast, there's no way to
   * dismiss this and keep using an incompatible extension. Never called
   * with null — once blocked, the true fix is updating + reloading, not an
   * in-session unblock (the running extension's own version, read once at
   * activation, can't change without a reload).
   */
  setVersionBlocked(entry: VersionEntry): void {
    this._versionBlockedEntry = entry;
    this._postMessage({ command: 'versionBlocked', entry });
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
   * Toggle the busy/streaming state — swaps the send button for a stop
   * indicator, disables input while a turn is in flight, and drives the
   * bouncing-dot agent loader in the timeline.
   */
  setBusy(busy: boolean): void {
    this._busy = busy;
    this._postMessage({ command: 'busyChanged', busy });
  }

  /**
   * Append streaming text to the current assistant turn.
   */
  appendText(text: string): void {
    this._postMessage({ command: 'appendText', text });
  }

  /**
   * Append a reasoning-trace delta (agent.reasoning SSE event) to the
   * current assistant turn's thinking disclosure.
   */
  appendReasoning(content: string): void {
    this._postMessage({ command: 'reasoning', content });
  }

  /**
   * Signal that the reasoning trace for the current turn is complete — the
   * webview collapses the disclosure to "Thought for Ns".
   */
  completeReasoning(): void {
    this._postMessage({ command: 'reasoningDone' });
  }

  /**
   * Record a tool call starting on the current assistant turn's timeline.
   */
  startToolCall(callId: string, name: string): void {
    this._postMessage({ command: 'toolStart', callId, name });
  }

  /**
   * Attach a deferred tool call's params (path, edits, command, ...) to its
   * already-running timeline entry, as soon as the hermes.tool.deferred
   * event arrives — before local execution, not just at completion — so the
   * webview can render a Claude-Code-style "Read(file.py)"/"Bash(cmd)" label
   * (and an edit_file diff stat) while the call is still in flight, not only
   * once it's done. Never called for a server-side tool (query_rag, etc.) —
   * those only ever get startToolCall/completeToolCall, no params.
   */
  setToolParams(callId: string, params: Record<string, unknown>): void {
    this._postMessage({ command: 'toolParams', callId, params });
  }

  /**
   * Show a pending clarify prompt (agent.clarify) on the current assistant
   * turn's timeline, at its actual position in the flow — the agent's turn
   * is blocked server-side until answerClarify (wired to onAnswerClarify)
   * resolves it.
   */
  showClarify(
    clarifyId: string,
    question: string,
    choices: string[] | null,
    multiple: boolean,
  ): void {
    this._postMessage({ command: 'clarify', clarifyId, question, choices, multiple });
  }

  /**
   * Show an inline Ask-mode approval card (in place of the old native
   * showInformationMessage popup) on the current assistant turn's timeline,
   * at the deferred tool call's actual position in the flow — ModeGate's
   * handle() is blocked in the extension host until answerApproval (wired to
   * onAnswerApproval) resolves it.
   */
  showApproval(callId: string, tool: string, params: Record<string, unknown>): void {
    this._postMessage({ command: 'approval', callId, tool, params });
  }

  /**
   * Mark a tool call as complete. `output` is only ever populated for a
   * deferred (IDE-executed) tool's local result — hermes-agent's
   * hermes.tool.progress "completed" frame for a server-side tool carries no
   * output (see src/streaming/sse.py), so non-deferred calls just flip to
   * "done" with no expandable detail, matching what the browser app shows
   * live too (its output-heavy row only appears after a history reload).
   */
  completeToolCall(callId: string, output?: unknown): void {
    this._postMessage({ command: 'toolComplete', callId, output });
  }

  /**
   * Clear the chat in the webview. If it's never been opened this session
   * (_view still null — _postMessage would silently no-op), latches a
   * pending-clear flag that _syncState() consumes on the next 'ready'
   * handshake instead of dropping the clear entirely.
   */
  clearChat(): void {
    if (!this._view) {
      this._pendingClear = true;
      return;
    }
    this._postMessage({ command: 'clearChat' });
  }

  /**
   * Render a restored session's transcript in the chat webview. Triggered
   * externally (from the navigator panel's Sessions section via
   * extension.ts's loadSessionIntoChat) rather than by this panel's own
   * message switch — session management lives entirely in the navigator now.
   */
  loadSessionIntoView(sessionId: string, messages: SessionMessage[]): void {
    this._postMessage({
      command: 'sessionLoaded',
      sessionId,
      turns: messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m, i) =>
          m.role === 'user'
            ? { id: `u${i}`, role: 'user', text: m.content ?? '' }
            : {
                id: `a${i}`,
                role: 'assistant',
                segments: m.content ? [{ kind: 'text', text: m.content }] : [],
                thinking: m.reasoning ?? '',
                thinkingStart: null,
                thinkingDone: true,
                thinkingSeconds: null,
                thinkingExpanded: false,
              },
        ),
    });
  }

  /**
   * Insert a mention token (e.g. "#feature/path.md" or "//feature-id") into
   * the chat input — triggered by clicking a doc/feature row in the
   * navigator panel.
   */
  insertMention(token: string): void {
    this._postMessage({ command: 'insertText', text: token });
  }

  /**
   * Resolve files dragged from VS Code's own Explorer into the composer
   * (the webview reads `text/uri-list` off the drop event — the standard
   * DND MIME type VS Code's tree views populate for webview drop targets;
   * see input-bar.tsx's handleDrop) into workspace-relative `<lf:path>`
   * tags, and insert them the same way a navigator-panel click does.
   *
   * Only `file`/`vscode-remote` scheme URIs resolve to something meaningful
   * here — a `<lf:path>` tag is a workspace-relative path, so a URI outside
   * any workspace folder (or an unparseable one) is silently dropped rather
   * than inserting a bogus/absolute path the agent can't read.
   */
  private _resolveDroppedUris(uris: unknown): void {
    if (!Array.isArray(uris)) return;
    const tokens: string[] = [];
    for (const raw of uris) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      let uri: vscode.Uri;
      try {
        uri = vscode.Uri.parse(raw, true);
      } catch {
        continue;
      }
      if (uri.scheme !== 'file' && uri.scheme !== 'vscode-remote') continue;
      const relative = vscode.workspace.asRelativePath(uri, false);
      // asRelativePath falls back to returning the input unchanged when it
      // isn't inside any workspace folder — an absolute/fsPath result at
      // this point means "not in this workspace", so skip it.
      if (!relative || relative === uri.fsPath) continue;
      tokens.push(buildMentionTag('lf', relative));
    }
    if (tokens.length === 0) return;
    this._postMessage({ command: 'insertText', text: tokens.join(' ') });
  }

  /**
   * Post a message to the webview.
   */
  private _postMessage(message: Record<string, unknown>): void {
    this._view?.webview.postMessage(message);
  }

  /**
   * Open a file path referenced in assistant text (see markdown.tsx's
   * file-path detection) in the editor. Absolute (/...) and home-relative
   * (~/...) paths are used as-is; anything else is resolved against the
   * first workspace folder, matching FileOps._resolvePath's convention.
   *
   * A path mentioned in prose (backtick code, not a `#` mention chip) isn't
   * necessarily a real source file in this workspace's local checkout — the
   * agent's own text can equally reference a workflow document (e.g.
   * "database/hermes-agent/v001/changelog.md") that only exists via
   * storage-service. So a failed local open here isn't treated as final: it
   * falls back to openWorkspaceDocument the same way a '#' chip click does
   * (as a workspace-root doc, since a bare backtick path carries no feature
   * association) before surfacing an error.
   */
  private async _openFile(target: string): Promise<void> {
    const uri = target.startsWith('~')
      ? vscode.Uri.file(os.homedir() + target.slice(1))
      : target.startsWith('/')
        ? vscode.Uri.file(target)
        : vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('/'),
            target,
          );
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch {
      await openWorkspaceDocument(
        { id: target, feature_id: null, path: target },
        this.codingApiCtx,
        this.docContentProvider,
      );
    }
  }
}
