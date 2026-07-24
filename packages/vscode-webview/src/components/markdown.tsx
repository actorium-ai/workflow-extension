import { type ComponentProps, createContext, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CHIP_CLASS } from '../utils/chip-styles.tsx';
import { remarkMentionChips } from '../utils/remark-mention-chips.ts';
import { getVsCodeApi } from '../utils/vscode-api.ts';
import { LifecycleGlyph } from './status-glyph.tsx';

const vscode = getVsCodeApi();

/** id -> feature_name, fetched once via panel.ts's listFeatureNames (see
 * use-chat-controller.ts's requestFeatureNames/featureNames) and provided
 * here so SpanRenderer's file-chip label can show which feature a doc
 * belongs to — mirrors digital-factory-ui's FeatureMentionWorkspaceContext/
 * useFeatureDetail. Needed because data-feature-id is a raw UUID by the
 * time a message is rendered (mentions.ts's resolveMentions rewrites the
 * slug to an id before sending) — undefined/empty means "not loaded yet",
 * in which case the chip falls back to showing no feature prefix at all,
 * same as dfui's own FileMentionPill while its query is loading. */
export const FeatureNamesContext = createContext<Record<string, string>>({});

/** id -> current_stage, fetched alongside FeatureNamesContext by the same
 * listFeatureNames round trip — feeds a `<ft:>` chip's LifecycleGlyph
 * (mirrors digital-factory-ui's FeatureMentionPill showing a status dot
 * before the feature name). */
export const FeatureStagesContext = createContext<Record<string, string>>({});

interface MarkdownProps {
  text: string;
  className?: string;
}

const REMARK_PLUGINS = [remarkGfm, remarkMentionChips];

// Absolute (/, ~/) or relative path-shaped text ending in a dot-extension —
// deliberately conservative (no spaces, at least one path separator or a
// leading dot-slash) so ordinary inline code like `count` or `npm install`
// never gets treated as a file. Fenced code blocks are never affected: those
// get a `language-xxx` className from remark, this only ever sees plain
// inline code (no className).
const FILE_PATH_RE = /^(?:[.~]?\/)?(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,10}$/;

function looksLikeFilePath(text: string): boolean {
  return !/\s/.test(text) && FILE_PATH_RE.test(text) && text.includes('/');
}

/** Inline code that looks like a file path renders underlined and clickable
 * — clicking posts 'openFile' to the extension host (see panel.ts), which
 * opens it in the editor. Anything else (fenced code, or inline code that
 * isn't path-shaped) renders exactly as react-markdown's own default. */
function CodeRenderer({ className, children, ...props }: ComponentProps<'code'>) {
  const text = typeof children === 'string' ? children : String(children ?? '');
  if (!className && looksLikeFilePath(text)) {
    return (
      <code
        className="cursor-pointer underline decoration-dotted hover:text-primary"
        onClick={() => vscode.postMessage({ command: 'openFile', path: text })}
        title={`Open ${text}`}
      >
        {text}
      </code>
    );
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

// Same canonical-doc friendly names as doc-list.tsx's PATH_LABELS (kept
// duplicated rather than imported — see that file's own comment on why:
// mirrors digital-factory-ui's own file-mention-link.tsx duplicating
// folder-tree-sidebar.tsx's PATH_LABELS rather than sharing it).
const FILE_MENTION_PATH_LABELS: Record<string, string> = {
  'product_spec.md': 'Product Spec',
  'tech_design.md': 'Technical Design',
  'tasks.md': 'Tasks',
  'handoff.md': 'Handoff',
};

/** Friendly display label for a `#` file chip's path — the owning feature's
 * name (if resolved — see FeatureNamesContext) plus any further folder
 * nesting, plus a friendly name for well-known canonical docs (falls back
 * to the basename). Mirrors digital-factory-ui's FileMentionPill exactly
 * ("<feature name> / <doc label>"). featureName is deliberately NOT derived
 * from data-feature-id directly: mentions.ts's resolveMentions rewrites
 * `<d:slug/path>` to `<d:UUID/path>` before a message is ever sent, so by
 * render time data-feature-id is a raw UUID, not a readable name — showing
 * that UUID would be a regression. featureName undefined (context not
 * loaded yet, or the id genuinely isn't in this workspace's feature list)
 * falls back to no prefix at all, same as dfui's own FileMentionPill while
 * its query is loading/failed. */
function fileMentionLabel(featureName: string | undefined, path: string): string {
  const slash = path.lastIndexOf('/');
  const basename = slash === -1 ? path : path.slice(slash + 1);
  const innerFolder = slash === -1 ? '' : path.slice(0, slash);
  const docLabel = FILE_MENTION_PATH_LABELS[basename] ?? basename;
  const pathLabel = innerFolder ? `${innerFolder}/${docLabel}` : docLabel;
  return featureName ? `${featureName} / ${pathLabel}` : pathLabel;
}

/** All five canonical tag kinds render as a styled chip here, using the
 * exact same per-kind Tailwind classes as digital-factory-ui's own
 * message.tsx (see utils/chip-styles.ts's CHIP_CLASS) — 'file' and
 * 'localfile' are additionally clickable (open the referenced doc/file),
 * matching dfui's FileMentionPill/MentionChip/FeatureMentionPill split
 * between "just a styled span" and "a clickable pill". Every branch below
 * uses CHIP_CLASS[kind] directly (never the inherited `className` prop,
 * which react-markdown never actually populates for these spans — the
 * mdast chip node built in remark-mention-chips.ts carries no className of
 * its own) and re-declares `data-chip={kind}` on its OWN returned span
 * rather than spreading `...rest`, so a chip's kind stays queryable in the
 * DOM even though the visual styling itself no longer depends on it. Only
 * the final catch-all fallback (an ordinary, non-chip span) spreads
 * `...rest`. */
function SpanRenderer({
  node: _node,
  className,
  children,
  ...rest
}: ComponentProps<'span'> & {
  node?: unknown;
}) {
  const attrs = rest as Record<string, unknown>;
  const kind = attrs['data-chip'];
  const featureNames = useContext(FeatureNamesContext);
  const featureStages = useContext(FeatureStagesContext);
  // Matches dfui's message.tsx chipHtmlForTag exactly — a small baseline
  // nudge so the chip's fixed 18px pill height doesn't sit visibly high
  // relative to surrounding prose text.
  const chipStyle = { transform: 'translateY(-1.5px)' };

  const featureId = attrs['data-feature-id'];
  const filePath = attrs['data-file-path'];
  if (kind === 'file' && typeof featureId === 'string' && typeof filePath === 'string') {
    return (
      <span
        data-chip={kind}
        className={CHIP_CLASS.file}
        style={chipStyle}
        onClick={() => vscode.postMessage({ command: 'openDocMention', featureId, path: filePath })}
        title={`Open ${filePath}`}
      >
        {fileMentionLabel(featureNames[featureId], filePath)}
      </span>
    );
  }

  const value = attrs['data-value'];
  if (kind === 'localfile' && typeof value === 'string') {
    return (
      <span
        data-chip={kind}
        className={CHIP_CLASS.localfile}
        style={chipStyle}
        onClick={() => vscode.postMessage({ command: 'openFile', path: value })}
        title={`Open ${value}`}
      >
        {value}
      </span>
    );
  }
  if (kind === 'command' && typeof value === 'string') {
    return (
      <span data-chip={kind} className={CHIP_CLASS.command} style={chipStyle}>{`/${value}`}</span>
    );
  }
  if (kind === 'mention' && typeof value === 'string') {
    return (
      <span data-chip={kind} className={CHIP_CLASS.mention} style={chipStyle}>{`@${value}`}</span>
    );
  }
  if (kind === 'feature' && typeof value === 'string') {
    // Same UUID caveat as fileMentionLabel above: value is the resolved
    // feature id by render time, not the slug — show the live-looked-up
    // name when available, falling back to the raw id only while
    // featureNames hasn't loaded (or this id genuinely isn't in the
    // workspace's feature list) rather than never resolving it at all.
    // The LifecycleGlyph before the name mirrors dfui's own
    // FeatureMentionPill (a status dot ahead of the feature name).
    return (
      <span data-chip={kind} className={CHIP_CLASS.feature} style={chipStyle}>
        {featureStages[value] && <LifecycleGlyph stage={featureStages[value]} size={11} />}
        {featureNames[value] ?? value}
      </span>
    );
  }

  return (
    <span className={className} {...rest}>
      {children}
    </span>
  );
}

/** react-markdown + remark-gfm (tables/strikethrough/task lists) plus a
 * custom remark plugin for @/#/// mention chips — mirrors digital-factory-ui's
 * message.tsx rendering approach instead of a hand-rolled regex parser. */
export function Markdown({ text, className }: MarkdownProps) {
  return (
    <div className={'prose-chat prose prose-sm max-w-none ' + (className ?? '')}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={{ code: CodeRenderer, span: SpanRenderer }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
