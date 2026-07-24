import { useCallback, useState } from 'react';

import type { MentionItem } from '../utils/types.ts';
import { getVsCodeApi } from '../utils/vscode-api.ts';

const vscode = getVsCodeApi();

/**
 * Owns the @/#///// and hand-typed-tag mention/command picker's own state —
 * split out of useChatController since it's a self-contained concern (no
 * dependency on turns/busy/connection state, just posts 'getMentions' to the
 * extension host and holds whatever it echoes back via a 'mentionResults'
 * message). useChatController still owns routing that extension message to
 * `setItems` below (it owns the single window 'message' listener all
 * extension→webview messages come through).
 */
export function useMentionState() {
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [mentionActivePrefix, setMentionActivePrefix] = useState<string | null>(null);
  const [mentionMatchStart, setMentionMatchStart] = useState(0);

  const closeMentionDropdown = useCallback(() => {
    setMentionItems([]);
    setMentionSelectedIndex(0);
    setMentionActivePrefix(null);
  }, []);

  const requestMentions = useCallback((prefix: string, query: string, matchStart: number) => {
    setMentionActivePrefix(prefix);
    setMentionMatchStart(matchStart);
    vscode.postMessage({ command: 'getMentions', prefix, query });
  }, []);

  /** Applies an incoming 'mentionResults' extension message — called from
   * useChatController's handleExtensionMessage switch. */
  const setResults = useCallback((items: MentionItem[]) => {
    setMentionItems(items);
    setMentionSelectedIndex(0);
  }, []);

  return {
    mentionItems,
    mentionSelectedIndex,
    setMentionSelectedIndex,
    mentionActivePrefix,
    mentionMatchStart,
    closeMentionDropdown,
    requestMentions,
    setResults,
  };
}
