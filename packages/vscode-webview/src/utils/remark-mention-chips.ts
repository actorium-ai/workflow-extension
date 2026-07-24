import {
  CHIP_KIND_FOR_TAG,
  MENTION_TAG_PATTERN,
  type MentionTagKind,
} from '@workflow-extension/shared';
import type { Link, Root, Text } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

// Canonical mention/command tag syntax (see shared/mention-tags.ts) — self-
// delimiting (angle brackets), so no leading-whitespace boundary check is
// needed the way the old bare-token forms (@handle, //slug, #slug/path,
// leading /command) required to avoid matching mid-word. Composer insertion
// (input-bar.tsx) always produces this exact tag form regardless of which
// trigger (@/#///// or a hand-typed tag) was used, so this is the ONLY form
// the renderer needs to understand.
//
// CommonMark parses ANY bare `<scheme:target>` span as an AUTOLINK (a "link"
// mdast node, not "text") as long as `scheme` is 2-32 ASCII letters/digits/
// +/-/. — that's core CommonMark grammar, applied during the initial parse,
// before this plugin (which only runs on the already-parsed tree) ever sees
// the text. Of this format's five tag letters, "ft"/"cmd"/"lf" satisfy that
// 2+-char minimum and get silently swallowed into a link node with
// url="ft:my-feature" instead of surfacing as a 'text' node at all —
// confirmed by literally rendering <ft:my-feature> and inspecting the DOM
// (it came out as a bare, non-functional <a>). "p"/"d" are single
// characters, too short to qualify, so those stay as plain text. Fixed by
// ALSO visiting 'link' nodes and checking whether their url matches this
// same tag shape (autolink parsing keeps "scheme:target" as the url, no
// angle brackets), not just 'text' nodes.
const AUTOLINK_TAG_PATTERN = /^(p|ft|d|cmd|lf):([^<>\s][^<>]*)$/;

function buildChipNode(tag: string, tagValue: string, token: string): Text {
  const kind = CHIP_KIND_FOR_TAG[tag as MentionTagKind] ?? 'mention';
  // 'file' (<d:...>) chips carry their parsed featureId/path as data
  // attributes so markdown.tsx's span override can compute a friendly
  // display label and wire a click handler (open the doc) without
  // re-parsing the raw tag text itself — mirrors digital-factory-ui's
  // FileMentionPill reading data-feature-id/data-file-path off the same
  // kind of span.
  const hProperties: Record<string, string> = { 'data-chip': kind };
  if (kind === 'file') {
    const slash = tagValue.indexOf('/');
    hProperties['data-feature-id'] = slash === -1 ? tagValue : tagValue.slice(0, slash);
    hProperties['data-file-path'] = slash === -1 ? '' : tagValue.slice(slash + 1);
  } else {
    hProperties['data-value'] = tagValue;
  }
  return {
    type: 'text',
    value: token,
    data: {
      hName: 'span',
      hProperties,
      hChildren: [{ type: 'text', value: token }],
    },
  } as unknown as Text;
}

// Single combined traversal (not two separate visit() passes) — each node
// is visited exactly once, so a chip node spliced in while handling a
// 'link' can never be re-encountered and re-processed by a later 'text'
// pass (its raw token text, e.g. "<ft:my-feature>", would otherwise match
// MENTION_TAG_PATTERN all over again).
// Matches a bare "/tool-name" at the very start of a message — the same
// shape input-bar.tsx's own '/'-trigger (runTriggerDetection) recognizes
// while composing. Selecting from that picker always converts to the
// canonical `<cmd:...>` tag, but a message can still reach the renderer as
// bare text: typed and sent without ever opening/selecting from the
// dropdown. Requiring whitespace-or-end right after the token (not another
// "/") means a real filesystem path like "/home/user/file" is never
// mistaken for a command.
const LEADING_COMMAND_PATTERN = /^\/([a-zA-Z][a-zA-Z0-9_-]*)(?=\s|$)/;

/** Rewrites a bare leading "/tool-name" into the canonical `<cmd:tool-name>`
 * tag so it renders through remarkMentionChips the same as a properly-picked
 * command — mirrors digital-factory-ui's message.tsx applyLeadingCommandTag.
 * Only meaningful for user turns (see message-list.tsx's call site) — the
 * agent has no reason to organically emit this shape in its own prose. */
export function applyLeadingCommandTag(text: string): string {
  if (text.startsWith('<cmd:')) return text;
  const match = text.match(LEADING_COMMAND_PATTERN);
  if (!match) return text;
  return `<cmd:${match[1]}>${text.slice(match[0].length)}`;
}

export const remarkMentionChips: Plugin<[], Root> = () => (tree) => {
  visit(
    tree,
    (n) => n.type === 'text' || n.type === 'link',
    (node, index, parent) => {
      if (!parent || index == null) return;

      if (node.type === 'link') {
        const link = node as Link;
        const m = link.url.match(AUTOLINK_TAG_PATTERN);
        if (!m) return;
        parent.children.splice(index, 1, buildChipNode(m[1], m[2], `<${link.url}>`));
        return index + 1;
      }
      const textNode = node as Text;

      const value = textNode.value;
      MENTION_TAG_PATTERN.lastIndex = 0;
      if (!MENTION_TAG_PATTERN.test(value)) return;
      MENTION_TAG_PATTERN.lastIndex = 0;

      const replacement: Text[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = MENTION_TAG_PATTERN.exec(value))) {
        const [token, tag, tagValue] = match;
        const start = match.index;
        if (start > lastIndex) {
          replacement.push({ type: 'text', value: value.slice(lastIndex, start) });
        }
        replacement.push(buildChipNode(tag, tagValue, token));
        lastIndex = start + token.length;
      }
      if (lastIndex < value.length) {
        replacement.push({ type: 'text', value: value.slice(lastIndex) });
      }

      parent.children.splice(index, 1, ...replacement);
      return index + replacement.length;
    },
  );
};
