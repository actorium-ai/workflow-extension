import { Dropdown } from '@heroui/react';
import {
  buildMentionTag,
  MENTION_TAG_PATTERN,
  type MentionTagKind,
  OPEN_MENTION_TAG_PATTERN,
} from '@workflow-extension/shared';
import {
  AtSign,
  File as FileIcon,
  FileCode2,
  ImagePlus,
  Loader2,
  Paperclip,
  Send,
  Square,
  SquareSlash,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { PendingFile } from '../state/use-pending-files.ts';
import type { PendingImage } from '../state/use-pending-images.ts';
import { CHIP_CLASS, CHIP_KIND_FOR_TAG, chipDisplayText } from '../utils/chip-styles.tsx';
import type {
  ActiveEditorContext,
  MentionItem,
  ModelOption,
  OperationalMode,
} from '../utils/types.ts';
import { MentionDropdown } from './mention-dropdown';
import { ModeSelect } from './mode-select';
import { ModelPicker } from './model-picker';

interface InputBarProps {
  visible: boolean;
  mode: OperationalMode;
  onSetMode: (mode: OperationalMode) => void;
  availableModels: ModelOption[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  activeContext: ActiveEditorContext | null;
  pendingImages: PendingImage[];
  onImagePaste: (file: File | Blob) => void;
  onImageRemove: (localId: string) => void;
  pendingFiles: PendingFile[];
  onFileAttach: (file: File) => void;
  onFileRemove: (localId: string) => void;
  onDropFiles: (uris: string[]) => void;
  slashCommands: { name: string; hint: string }[];
  onRequestSlashCommands: () => void;
  mentionItems: MentionItem[];
  mentionSelectedIndex: number;
  onMentionSelectedIndexChange: (index: number) => void;
  mentionActivePrefix: string | null;
  mentionMatchStart: number;
  onRequestMentions: (prefix: string, query: string, matchStart: number) => void;
  onCloseMentionDropdown: () => void;
  onSendMessage: () => void;
  onStopOrSend: () => void;
  isBusy: boolean;
}

/** Thumbnail strip for images pasted/attached to the pending message —
 * mirrors digital-factory-ui's PendingImageStrip (prompt-input.tsx). */
function PendingImageStrip({
  images,
  onRemove,
}: {
  images: PendingImage[];
  onRemove: (localId: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 border-b border-border/50 p-2">
      {images.map((img) => (
        <div
          key={img.localId}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded border border-border"
        >
          <img src={img.previewUrl} alt="" className="h-full w-full object-cover" />
          {img.status === 'uploading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="h-4 w-4 animate-spin text-white" aria-hidden="true" />
            </div>
          )}
          {img.status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-danger/70">
              <span className="text-[10px] text-white">Failed</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => onRemove(img.localId)}
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
            aria-label="Remove image"
          >
            <X className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Chip strip for non-image files attached to the pending message — mirrors
 * PendingImageStrip's shape, but shows a filename/size chip instead of a
 * thumbnail (a generic file has nothing to preview). */
function PendingFileStrip({
  files,
  onRemove,
}: {
  files: PendingFile[];
  onRemove: (localId: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 border-b border-border/50 p-2">
      {files.map((f) => (
        <div
          key={f.localId}
          className={
            'flex items-center gap-1.5 rounded-md border border-border bg-surface-secondary px-2 py-1 text-[11px] text-text-primary' +
            (f.status === 'error' ? ' border-danger/60 text-danger' : '')
          }
        >
          {f.status === 'uploading' ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <FileIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
          <span className="max-w-[10rem] truncate">{f.name}</span>
          <span className="shrink-0 text-text-muted">
            {f.status === 'error' ? 'Failed' : formatFileSize(f.size)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(f.localId)}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-primary"
            aria-label={`Remove ${f.name}`}
          >
            <X className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function sectionHeaderItem(id: string, label: string) {
  return (
    <Dropdown.Item
      key={id}
      id={id}
      textValue={label}
      className="pointer-events-none px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-text-muted opacity-100"
    >
      {label}
    </Dropdown.Item>
  );
}

const COMMAND_ITEM_PREFIX = 'cmd:';
const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-primary outline-none transition-colors hover:bg-surface-secondary data-[focused]:bg-surface-secondary';

/** Claude-Code-style actions menu for the composer toolbar (a "/" trigger
 * icon, not "+" — mirrors digital-factory-ui's own PromptInputAttachButton,
 * same HeroUI Dropdown composition and same reason for the icon choice). A
 * "Context" section (attach an image, jump to the '@' local-file picker)
 * followed by a "Slash commands" section listing the real, live tool
 * catalog (panel.ts's listSlashCommands, fetched on open) — picking one
 * inserts the `<cmd:name>` tag directly. */
function ActionsMenu({
  onAttachImage,
  onAttachFile,
  onMentionFile,
  onSelectCommand,
  slashCommands,
  onRequestSlashCommands,
}: {
  onAttachImage: (file: File) => void;
  onAttachFile: (file: File) => void;
  onMentionFile: () => void;
  onSelectCommand: (command: string) => void;
  slashCommands: { name: string; hint: string }[];
  onRequestSlashCommands: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestedRef = useRef(false);
  return (
    <>
      <Dropdown.Root
        onOpenChange={(open) => {
          if (open && !requestedRef.current) {
            requestedRef.current = true;
            onRequestSlashCommands();
          }
        }}
      >
        <Dropdown.Trigger
          aria-label="Add to message"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface-subtle"
        >
          <SquareSlash className="h-4 w-4" aria-hidden="true" />
        </Dropdown.Trigger>
        <Dropdown.Popover
          placement="top start"
          className="w-64 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          <Dropdown.Menu
            onAction={(key) => {
              const id = String(key);
              if (id === 'attach-image') inputRef.current?.click();
              else if (id === 'attach-file') fileInputRef.current?.click();
              else if (id === 'mention-file') onMentionFile();
              else if (id.startsWith(COMMAND_ITEM_PREFIX))
                onSelectCommand(id.slice(COMMAND_ITEM_PREFIX.length));
            }}
            className="max-h-64 overflow-y-auto"
          >
            {[
              sectionHeaderItem('__hdr_context', 'Context'),
              <Dropdown.Item
                key="attach-image"
                id="attach-image"
                textValue="Attach image"
                className={ITEM_CLASS}
              >
                <ImagePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Attach image
              </Dropdown.Item>,
              <Dropdown.Item
                key="attach-file"
                id="attach-file"
                textValue="Attach file"
                className={ITEM_CLASS}
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Attach file
              </Dropdown.Item>,
              <Dropdown.Item
                key="mention-file"
                id="mention-file"
                textValue="Mention file"
                className={ITEM_CLASS}
              >
                <AtSign className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Mention file
              </Dropdown.Item>,
              ...(slashCommands.length > 0
                ? [
                    sectionHeaderItem('__hdr_slash', 'Slash commands'),
                    ...slashCommands.map((cmd) => (
                      <Dropdown.Item
                        key={cmd.name}
                        id={`${COMMAND_ITEM_PREFIX}${cmd.name}`}
                        textValue={cmd.name}
                        className="flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1 outline-none transition-colors hover:bg-surface-secondary data-[focused]:bg-surface-secondary"
                      >
                        <span className="flex w-full min-w-0 items-center gap-1.5 font-mono text-[11px] text-text-primary">
                          <SquareSlash className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{cmd.name}</span>
                        </span>
                        <span className="w-full truncate pl-[18px] text-[10px] text-text-muted">
                          {cmd.hint}
                        </span>
                      </Dropdown.Item>
                    )),
                  ]
                : []),
            ]}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown.Root>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAttachImage(file);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAttachFile(file);
          e.target.value = '';
        }}
      />
    </>
  );
}

/** Informational chip showing what ContextGatherer.gather() is about to pick
 * up from the active editor on the next send (file, and selected line range
 * if any) — mirrors Claude Code's own composer pill ("8 lines selected").
 * Purely a readout, not a control — there's no "detach" action here, since
 * gather() always reads the live editor state fresh, not a snapshot this
 * chip could get out of sync with. */
function ActiveContextChip({ context }: { context: ActiveEditorContext | null }) {
  if (!context) return null;
  const basename = context.path.split('/').pop() || context.path;
  const label = context.selection
    ? context.selection.startLine === context.selection.endLine
      ? `${basename} (line ${context.selection.startLine})`
      : `${basename} (lines ${context.selection.startLine}–${context.selection.endLine})`
    : basename;
  return (
    <div className="flex items-center gap-1.5 border-b border-border/50 px-3 py-1.5 text-[11px] text-text-muted">
      <FileCode2 className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate" title={context.path}>
        {label}
      </span>
    </div>
  );
}

/** Canonical tag kind (see shared/types.ts) inserted for each trigger
 * prefix — the composer always inserts (and the renderer/resolve step
 * always parses) `<kind:value>`, not the bare `@handle`/`//slug`/
 * `#slug/path`/`/command` forms these triggers used to insert directly. `/`
 * no longer runs a local client-side action (the extension's old
 * clear/mode-ask/etc slash commands are gone) — it now picks from the live
 * tool registry and inserts `<cmd:tool-name>` as ordinary composer text,
 * exactly like every other mention kind, mirroring digital-factory-ui's own
 * slash commands (real tool names, sent as literal agent-visible text, not
 * intercepted). No 'p' entry — this app has no people-mention picker, only
 * local-file (that's what '@' means here; digital-factory-ui's '@' means
 * people instead — see its own copy of this mapping). */
const TAG_KIND_FOR_PREFIX: Record<string, MentionTagKind> = {
  '@': 'lf',
  '#': 'd',
  '//': 'ft',
  '/': 'cmd',
};

const CHIP_TAG_ATTR = 'data-chip-tag';

/** Builds one atomic, non-editable chip node for a matched `<kind:value>`
 * tag — `contenteditable="false"` on an inline span inside a
 * `contenteditable="true"` container is the standard technique for atomic
 * inline tokens, so the browser's own caret/selection model treats it as
 * one unit for navigation. Styled via the shared per-kind Tailwind classes
 * (utils/chip-styles.ts) — mirrors digital-factory-ui's own composer
 * exactly, so a chip looks identical whether it's still being typed or
 * already sent (markdown.tsx's SpanRenderer uses the same CHIP_CLASS map). */
function buildChipNode(tag: string, tagValue: string, token: string): HTMLSpanElement {
  const kind = CHIP_KIND_FOR_TAG[tag as MentionTagKind] ?? 'mention';
  const span = document.createElement('span');
  span.setAttribute('contenteditable', 'false');
  span.dataset.chip = kind;
  span.className = CHIP_CLASS[kind];
  span.setAttribute(CHIP_TAG_ATTR, token);
  const displayText = chipDisplayText(tag as MentionTagKind, tagValue);
  span.textContent = displayText;
  // The chip's own max-w-[90%] truncate (chip-styles.ts) can now clip a long
  // path — a title tooltip keeps the full text reachable on hover instead of
  // it being lost to the ellipsis.
  span.title = displayText;
  return span;
}

/** Serializes a contentEditable root's children back to the canonical
 * `<kind:value>` string — the DOM is only ever a rendering of this string,
 * never independently authoritative. Text nodes contribute their text; chip
 * nodes contribute their stored original tag text (not their display text). */
function serializeNode(root: Node): string {
  let out = '';
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node instanceof HTMLElement && node.hasAttribute(CHIP_TAG_ATTR)) {
      out += node.getAttribute(CHIP_TAG_ATTR) ?? '';
    } else if (node instanceof HTMLElement) {
      out += node.textContent ?? '';
    }
  });
  return out;
}

/** Renders the canonical string into a root's children (text nodes + chip
 * spans), replacing whatever was there. Called on mount and whenever the
 * value changes from OUTSIDE typing (send-clear, drag-drop insert, picker
 * insert) — never on every keystroke, since normal typing is left to the
 * browser's native contentEditable behavior. */
function renderValueIntoDom(root: HTMLElement, value: string) {
  root.textContent = '';
  let lastIndex = 0;
  const re = new RegExp(MENTION_TAG_PATTERN.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const [token, tag, tagValue] = m;
    if (m.index > lastIndex) {
      root.appendChild(document.createTextNode(value.slice(lastIndex, m.index)));
    }
    root.appendChild(buildChipNode(tag, tagValue, token));
    lastIndex = m.index + token.length;
  }
  if (lastIndex < value.length || root.childNodes.length === 0) {
    root.appendChild(document.createTextNode(value.slice(lastIndex)));
  }
}

/** Places the caret at a given string OFFSET into the canonical value,
 * walking the root's children (text nodes contribute their length, chip
 * nodes contribute their stored tag-text length) to find the corresponding
 * DOM position. Only needed for external value changes with an explicit
 * target position — normal typing never needs this, the browser positions
 * its own caret natively. */
function setCaretAtOffset(root: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  let remaining = offset;
  for (const node of Array.from(root.childNodes)) {
    const len =
      node.nodeType === Node.TEXT_NODE
        ? (node.textContent?.length ?? 0)
        : ((node as HTMLElement).getAttribute(CHIP_TAG_ATTR)?.length ?? 0);
    if (node.nodeType === Node.TEXT_NODE && remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    if (remaining <= len) {
      // Target offset falls inside a chip's span (or right after it) —
      // chips are atomic, so land just after the chip node instead of
      // "inside" it.
      const range = document.createRange();
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Serializes just the text from the start of `root` up to the current
 * caret — used for trigger detection (typing `@`/`//`/`#`/`/` or a
 * hand-typed `<kind:` tag), which operates on "the string so far" exactly
 * like the old plain-textarea version did. */
function getTextBeforeCaret(root: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.getRangeAt(0).startContainer)) {
    return serializeNode(root);
  }
  const caret = sel.getRangeAt(0);
  const preRange = document.createRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(caret.startContainer, caret.startOffset);
  return serializeNode(preRange.cloneContents());
}

/** Finds the chip node immediately adjacent to a collapsed caret, in the
 * direction Backspace (look backward) or Delete (look forward) would act.
 * Chips are always direct children of `root` (never nested inside a text
 * run), so this only needs to check two shapes: the caret's container is a
 * text node at its very start/end (check that text node's previous/next
 * sibling), or the caret's container IS `root` itself (caret positioned
 * directly between children, e.g. between two adjacent chips with no text
 * between them). */
function findAdjacentChip(root: HTMLElement, key: 'Backspace' | 'Delete'): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return null;
  const { startContainer, startOffset } = sel.getRangeAt(0);
  if (!root.contains(startContainer)) return null;

  let candidate: Node | null = null;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const len = startContainer.textContent?.length ?? 0;
    if (key === 'Backspace' && startOffset === 0) candidate = startContainer.previousSibling;
    if (key === 'Delete' && startOffset === len) candidate = startContainer.nextSibling;
  } else if (startContainer === root) {
    candidate =
      key === 'Backspace' ? root.childNodes[startOffset - 1] : root.childNodes[startOffset];
  }
  return candidate instanceof HTMLElement && candidate.hasAttribute(CHIP_TAG_ATTR)
    ? candidate
    : null;
}

export function InputBar({
  visible,
  mode,
  onSetMode,
  availableModels,
  selectedModelId,
  onSelectModel,
  inputValue,
  onInputValueChange,
  activeContext,
  pendingImages,
  onImagePaste,
  onImageRemove,
  pendingFiles,
  onFileAttach,
  onFileRemove,
  onDropFiles,
  slashCommands,
  onRequestSlashCommands,
  mentionItems,
  mentionSelectedIndex,
  onMentionSelectedIndexChange,
  mentionActivePrefix,
  mentionMatchStart,
  onRequestMentions,
  onCloseMentionDropdown,
  onSendMessage,
  onStopOrSend,
  isBusy,
}: InputBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const isComposingRef = useRef(false);
  // Tracks the last string THIS component itself emitted via
  // onInputValueChange, so the value-sync effect below can tell "value prop
  // changed because I typed" (DOM already reflects it, skip re-render) from
  // "value changed externally" (drag-drop insert, picker insert, send-clear
  // — re-render the DOM from the new string).
  const lastEmittedRef = useRef<string | null>(null);
  const pendingCaretOffsetRef = useRef<number | null>(null);

  // Sets a new value WITHOUT touching the DOM (mention/picker insert, drag-
  // drop insert, paste-append fallback — the new string is computed purely,
  // the contentEditable div itself hasn't been mutated). Deliberately does
  // NOT set lastEmittedRef, so the value-sync effect below still sees this
  // as an "external" change and re-renders the DOM from the new string. The
  // opposite of handleInput/the atomic-delete branch, which DO set
  // lastEmittedRef because THEY mutate the DOM directly first.
  function setValueExternally(newValue: string, caretOffset: number | null) {
    pendingCaretOffsetRef.current = caretOffset;
    onInputValueChange(newValue);
  }

  // Accepts either (a) a doc/feature row dragged in from the navigator panel
  // (primary sidebar) — a plain HTML5 drag-and-drop between the two separate
  // webviews (chat lives in the secondary sidebar), each row sets the same
  // "#<label>"/"//<id>" mention token as its text/plain payload that clicking
  // it would insert (see doc-list.tsx/feature-list.tsx onDragStart) — or (b) a
  // file dragged in from VS Code's own Explorer, which populates the standard
  // text/uri-list DND MIME type instead of text/plain. Explorer drops need a
  // workspace-relative path, which only the extension host can compute
  // (vscode.workspace.asRelativePath) — resolved async via onDropFiles/
  // panel.ts's resolveDroppedUris, then inserted the same way a navigator
  // click does (the existing 'insertText' round trip).
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const token = e.dataTransfer.getData('text/plain');
    if (token) {
      const newValue = inputValue ? `${inputValue} ${token}` : token;
      setValueExternally(newValue, newValue.length);
      rootRef.current?.focus();
      return;
    }
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (uriList) {
      const uris = uriList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      if (uris.length > 0) onDropFiles(uris);
    }
  }

  // Auto-resize on every value change (typing, clearing after send, mention
  // token insertion) — matches the vanilla version's manual resize calls at
  // each mutation site, just centralized.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [inputValue]);

  // Re-render the DOM from `inputValue` whenever it changes from OUTSIDE
  // this component's own typing (send-clear, drag-drop, picker insertion) —
  // see lastEmittedRef's own comment above.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (lastEmittedRef.current === inputValue) return;
    renderValueIntoDom(root, inputValue);
    if (root === document.activeElement || root.contains(document.activeElement)) {
      const offset = pendingCaretOffsetRef.current ?? inputValue.length;
      setCaretAtOffset(root, offset);
    }
    pendingCaretOffsetRef.current = null;
  }, [inputValue]);

  function runTriggerDetection(val: string, cursorPos: number) {
    const beforeCaret = val.slice(0, cursorPos);

    // Hand-typing the full canonical tag directly (no picker) also opens the
    // matching picker, live-filtered by whatever's typed after the colon so
    // far — e.g. typing "<ft:agent" opens the feature picker filtered to
    // "agent", same as typing "//agent" would. Only 'lf'/'ft'/'d'/'cmd' are
    // recognized here (no 'p' — this app has no people-mention picker; see
    // TAG_KIND_FOR_PREFIX's own comment on why '@' means local-file here,
    // not people).
    const tagMatch = beforeCaret.match(OPEN_MENTION_TAG_PATTERN);
    if (tagMatch && tagMatch[1] !== 'p') {
      const prefix = { lf: '@', ft: '//', d: '#', cmd: '/' }[
        tagMatch[1] as 'lf' | 'ft' | 'd' | 'cmd'
      ];
      onRequestMentions(prefix, tagMatch[2] ?? '', tagMatch.index as number);
      return;
    }

    // Leading "/" is a slash command — only while typing the command token
    // itself (no space yet), and only a SINGLE slash — "//" at position 0 is
    // a feature mention (falls through to the regex match below), not a
    // slash command. Without the charAt(1) check, "//" always matched this
    // branch first (it only ever looked at the first character), so typing
    // "//" at the very start of the input silently routed to the '/'
    // slash-command picker instead — which then filtered to zero results
    // (no slash command contains "/") and rendered no dropdown at all.
    if (
      val.charAt(0) === '/' &&
      val.charAt(1) !== '/' &&
      beforeCaret.indexOf(' ') === -1 &&
      beforeCaret.indexOf('\n') === -1
    ) {
      onRequestMentions('/', val.slice(1, cursorPos), 0);
      return;
    }

    const match = beforeCaret.match(/([@#]|\/\/)\S*$/);
    if (match) {
      const prefix = match[0].charAt(0) === '/' ? '//' : match[0].charAt(0);
      const query = match[0].substring(prefix.length);
      onRequestMentions(prefix, query, match.index as number);
    } else {
      onCloseMentionDropdown();
    }
  }

  function selectMentionItem(idx: number) {
    const item = mentionItems[idx];
    const root = rootRef.current;
    if (!item || !mentionActivePrefix || !root) return;

    const kind = TAG_KIND_FOR_PREFIX[mentionActivePrefix];
    const caret = getTextBeforeCaret(root).length;
    const before = inputValue.slice(0, mentionMatchStart);
    const after = inputValue.slice(caret);
    const token = buildMentionTag(kind, item.insertValue ?? item.label) + ' ';
    const newValue = before + token + after;
    setValueExternally(newValue, (before + token).length);
    onCloseMentionDropdown();
    requestAnimationFrame(() => root.focus());
  }

  // "Mention file" entry in the "+" actions menu — inserts the '@' trigger
  // character at the caret and opens the file picker immediately, the same
  // dropdown typing '@' yourself would open, saving the keystroke.
  function handleMentionFileClick() {
    const root = rootRef.current;
    if (!root) return;
    const caret = getTextBeforeCaret(root).length;
    const newValue = inputValue.slice(0, caret) + '@' + inputValue.slice(caret);
    setValueExternally(newValue, caret + 1);
    onRequestMentions('@', '', caret);
    requestAnimationFrame(() => root.focus());
  }

  // Picking a command directly from the actions menu's "Slash commands"
  // section — inserts the same `<cmd:name>` tag the '/'-triggered
  // MentionDropdown's own selectMentionItem would, just without going
  // through that intermediate picker first. Replaces the current draft
  // (matching the '/' trigger only ever working at the very start of the
  // message).
  function handleSelectCommand(command: string) {
    const token = buildMentionTag('cmd', command) + ' ';
    setValueExternally(token, token.length);
    const root = rootRef.current;
    requestAnimationFrame(() => root?.focus());
  }

  function handleInput() {
    const root = rootRef.current;
    if (!root) return;
    const newValue = serializeNode(root);
    lastEmittedRef.current = newValue;
    onInputValueChange(newValue);
    if (!isComposingRef.current) {
      runTriggerDetection(newValue, getTextBeforeCaret(root).length);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // A pasted screenshot/image (e.g. Cmd+Shift+4 then Cmd+V) arrives as a
    // 'file' clipboard item, not text — check for that FIRST, before forcing
    // plain-text below, or the image is silently dropped. Mirrors
    // digital-factory-ui's own paste handler.
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) onImagePaste(file);
          return;
        }
      }
    }

    // contentEditable pastes rich HTML by default — always force plain text,
    // both to match the old textarea's native plain-text-only paste and to
    // never let pasted content forge chip markup.
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const sel = window.getSelection();
    const root = rootRef.current;
    if (root && sel && sel.rangeCount > 0 && root.contains(sel.getRangeAt(0).startContainer)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      handleInput();
    } else if (root) {
      const newValue = inputValue + text;
      setValueExternally(newValue, newValue.length);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (mentionItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onMentionSelectedIndexChange((mentionSelectedIndex + 1) % mentionItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onMentionSelectedIndexChange(
          (mentionSelectedIndex - 1 + mentionItems.length) % mentionItems.length,
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMentionItem(mentionSelectedIndex);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseMentionDropdown();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // IME composition (CJK, Vietnamese, etc.) confirms its candidate with
      // Enter too — that keydown must not be treated as "send", or the
      // composing keystroke and the user's real send both submit the
      // message. Mirrors digital-factory-ui's identical guard.
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      onSendMessage();
      return;
    }

    const root = rootRef.current;
    if (!root) return;

    // Atomic delete: with no selection, Backspace/Delete right at a chip's
    // edge removes the whole chip, not one character.
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const chip = findAdjacentChip(root, e.key);
      if (chip) {
        e.preventDefault();
        const caretOffsetBefore =
          getTextBeforeCaret(root).length -
          (e.key === 'Backspace' ? (chip.getAttribute(CHIP_TAG_ATTR)?.length ?? 0) : 0);
        chip.remove();
        const newValue = serializeNode(root);
        lastEmittedRef.current = newValue;
        pendingCaretOffsetRef.current = caretOffsetBefore;
        onInputValueChange(newValue);
      }
    }
  }

  return (
    <div className={(visible ? 'block' : 'hidden') + ' shrink-0 bg-surface p-3'}>
      {/* Mirrors digital-factory-ui's prompt-input.tsx PromptInput: a single
          bordered drop-zone containing both the composer and the toolbar row
          (model/mode pickers + send button), rather than the toolbar living
          in a separate row below the box. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={
          'flex flex-col rounded-md border bg-bg focus-within:border-accent focus-within:shadow-[0_0_0_1px_var(--color-accent)] ' +
          (isDragOver ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-primary')
        }
      >
        <ActiveContextChip context={activeContext} />
        <PendingImageStrip images={pendingImages} onRemove={onImageRemove} />
        <PendingFileStrip files={pendingFiles} onRemove={onFileRemove} />
        <div className="relative">
          <div
            ref={rootRef}
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label="Message Agent"
            data-placeholder="Message Agent"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
              handleInput();
            }}
            className="block max-h-[200px] min-h-9 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-3 py-2 text-sm text-text-primary outline-none empty:before:text-text-muted empty:before:content-[attr(data-placeholder)]"
          />
          <MentionDropdown
            items={mentionItems}
            selectedIndex={mentionSelectedIndex}
            activePrefix={mentionActivePrefix}
            onSelect={selectMentionItem}
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">
            <ModelPicker
              models={availableModels}
              selectedId={selectedModelId}
              onSelect={onSelectModel}
            />
            <ModeSelect mode={mode} onSetMode={onSetMode} />
            <ActionsMenu
              onAttachImage={onImagePaste}
              onAttachFile={onFileAttach}
              onMentionFile={handleMentionFileClick}
              onSelectCommand={handleSelectCommand}
              slashCommands={slashCommands}
              onRequestSlashCommands={onRequestSlashCommands}
            />
          </div>
          <button
            className={
              'flex h-7 w-7 shrink-0 items-center justify-center rounded ' +
              (isBusy
                ? 'bg-danger text-white'
                : 'bg-primary text-primary-foreground hover:bg-primary-hover')
            }
            onClick={onStopOrSend}
            title="Send (stops the current turn when clicked with an empty input)"
          >
            {isBusy ? (
              <Square className="h-3 w-3 fill-current" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
