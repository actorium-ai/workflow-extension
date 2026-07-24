import { MENTION_TAG_PATTERN, type MentionTagKind } from '@workflow-extension/shared';
import type React from 'react';

import { LifecycleGlyph } from '../components/status-glyph.tsx';

/** Shared per-kind chip class strings — mirrors digital-factory-ui's own
 * chip-styles.ts exactly (same base shape, same per-kind colors/tokens),
 * the single source of truth for how a `<p:>`/`<ft:>`/`<d:>`/`<cmd:>`/
 * `<lf:>` tag looks whether rendered in a SENT message (markdown.tsx's
 * SpanRenderer) or live while typing (input-bar.tsx's contentEditable
 * composer) — factored out here so the two can never visually drift apart,
 * same reason dfui shares its own copy between message.tsx and
 * prompt-input.tsx. No 'p' kind here — this app has no people-mention
 * picker (see input-bar.tsx's TAG_KIND_FOR_PREFIX comment on why '@' means
 * local-file here instead), but 'mention' is kept in the type/map in case a
 * message synced from digital-factory-ui (which does have `<p:handle>`) is
 * ever rendered/recalled here. */

export type ChipKind = 'mention' | 'feature' | 'file' | 'command' | 'localfile';

export const CHIP_KIND_FOR_TAG: Record<MentionTagKind, ChipKind> = {
  p: 'mention',
  ft: 'feature',
  d: 'file',
  cmd: 'command',
  lf: 'localfile',
};

// All five kinds share the same pill SHAPE (inline-flex, fixed 18px height,
// rounded, no-underline, hover feedback) so a message reads as one coherent
// chip language — only the color (and command/localfile's monospace, since
// tool names and paths read better in code font) differs per kind.
const CHIP_BASE =
  'inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded px-1 text-[12px] font-semibold leading-none no-underline transition-colors align-middle';

export const CHIP_CLASS: Record<ChipKind, string> = {
  mention: `${CHIP_BASE} bg-primary/15 text-accent-foreground hover:bg-primary hover:text-white`,
  feature: `${CHIP_BASE} bg-purple/15 text-purple-light cursor-pointer hover:bg-purple hover:text-white`,
  file: `${CHIP_BASE} bg-primary/15 text-accent-foreground cursor-pointer hover:bg-primary hover:text-white`,
  command: `${CHIP_BASE} bg-chip-bg font-mono text-text-secondary hover:bg-chip-bg/70 hover:text-text-primary`,
  localfile: `${CHIP_BASE} bg-chip-bg font-mono text-text-secondary cursor-pointer hover:bg-chip-bg/70 hover:text-text-primary`,
};

// Same canonical-doc friendly names as doc-list.tsx/markdown.tsx's own
// PATH_LABELS (kept duplicated rather than imported — see those files' own
// comment on why: mirrors digital-factory-ui's file-mention-link.tsx
// duplicating folder-tree-sidebar.tsx's PATH_LABELS rather than sharing it).
const FILE_MENTION_PATH_LABELS: Record<string, string> = {
  'product_spec.md': 'Product Spec',
  'tech_design.md': 'Technical Design',
  'tasks.md': 'Tasks',
  'handoff.md': 'Handoff',
};

/** Plain-text label for a chip's content — mirrors markdown.tsx's
 * SpanRenderer (the sent-bubble rendering) closely enough that a chip reads
 * consistently whether it's still being typed (input-bar.tsx's composer),
 * already sent, or shown in a single-line context outside the full
 * markdown pipeline (HighlightedText below). `featureNames` (id -> name)
 * resolves the 'ft'/'d' kinds' feature id/prefix to a readable name when
 * available — by the time ANY of these call sites see the tag, `tagValue`
 * is a raw feature UUID, not the human-typed slug (mentions.ts's
 * resolveMentions rewrites it before the message is ever sent), so without
 * a lookup the chip permanently shows a UUID instead of a name. Omit
 * `featureNames` (or pass an id the map doesn't have) to fall back to the
 * raw id, matching the pre-resolution behavior this replaces. */
export function chipDisplayText(
  tag: MentionTagKind,
  tagValue: string,
  featureNames?: Record<string, string>,
): string {
  if (tag === 'p') return `@${tagValue}`;
  if (tag === 'ft') return featureNames?.[tagValue] ?? tagValue;
  if (tag === 'd') {
    const slash = tagValue.indexOf('/');
    const featureId = slash === -1 ? '' : tagValue.slice(0, slash);
    const path = slash === -1 ? tagValue : tagValue.slice(slash + 1);
    const pathSlash = path.lastIndexOf('/');
    const basename = pathSlash === -1 ? path : path.slice(pathSlash + 1);
    const innerFolder = pathSlash === -1 ? '' : path.slice(0, pathSlash);
    const featureLabel = featureNames?.[featureId] ?? featureId;
    const folder = innerFolder ? `${featureLabel}/${innerFolder}` : featureLabel;
    const label = FILE_MENTION_PATH_LABELS[basename] ?? basename;
    return folder ? `${folder}/${label}` : label;
  }
  if (tag === 'cmd') return `/${tagValue}`;
  return tagValue; // 'lf'
}

/** Renders a plain string that may contain raw `<kind:value>` tags as a mix
 * of plain text and styled chip spans — mirrors digital-factory-ui's own
 * HighlightedText (chip-styles.tsx) exactly, for the identical reason: any
 * single-line, already-sent text shown OUTSIDE the full markdown pipeline
 * (session-list.tsx's title/excerpt rows, header.tsx's chat title) would
 * otherwise show the literal bracketed tag syntax as plain text.
 * `featureNames` is passed straight through to chipDisplayText — see its
 * own doc comment. Caller supplies the wrapping element's own truncation
 * (e.g. a `truncate` className on a parent) — this only ever returns a
 * flat list of text/chip nodes, never a block-level wrapper of its own. */
export function HighlightedText({
  text,
  featureNames,
  featureStages,
}: {
  text: string;
  featureNames?: Record<string, string>;
  /** Feature id -> current_stage — adds a LifecycleGlyph before a `<ft:>`
   * chip's name, same as markdown.tsx's SpanRenderer. Omit to render the
   * name alone (no icon), e.g. for a caller that never fetched stages. */
  featureStages?: Record<string, string>;
}) {
  const nodes: React.ReactNode[] = [];
  const re = new RegExp(MENTION_TAG_PATTERN.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text))) {
    const [token, tag, tagValue] = match;
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const kind = CHIP_KIND_FOR_TAG[tag as MentionTagKind] ?? 'mention';
    nodes.push(
      <span key={key++} className={CHIP_CLASS[kind]}>
        {kind === 'feature' && featureStages?.[tagValue] && (
          <LifecycleGlyph stage={featureStages[tagValue]} size={11} />
        )}
        {chipDisplayText(tag as MentionTagKind, tagValue, featureNames)}
      </span>,
    );
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return <>{nodes}</>;
}
