/**
 * Unit tests for the SSE client event parsing.
 *
 * Tests the SSE event type detection and parsing logic
 * in isolation from network I/O.
 */

import { deepStrictEqual } from 'assert';

// ── SSE event types ────────────────────────────────────────────────────
type SSEEvent =
  | { type: 'chat.completion.chunk'; content: string }
  | {
      type: 'hermes.tool.deferred';
      tool_call_id: string;
      tool: string;
      params: Record<string, unknown>;
    }
  | { type: 'hermes.tool.progress'; tool_call_id: string; status: string }
  | { type: 'cost'; data: { balance: number; used: number } }
  | { type: 'done' }
  | { type: 'error'; error: string };

// ── SSE parsing ────────────────────────────────────────────────────────
function parseSSEEvent(data: string): SSEEvent | null {
  if (!data || data === '[DONE]') {
    return { type: 'done' };
  }

  try {
    const parsed = JSON.parse(data) as SSEEvent;
    return parsed;
  } catch {
    return null;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

// chat.completion.chunk
{
  const event = parseSSEEvent('{"type":"chat.completion.chunk","content":"Hello"}');
  deepStrictEqual(event?.type, 'chat.completion.chunk');
  deepStrictEqual((event as { type: 'chat.completion.chunk'; content: string }).content, 'Hello');
}

// hermes.tool.deferred
{
  const deferredData = JSON.stringify({
    type: 'hermes.tool.deferred',
    tool_call_id: 'call_abc123',
    tool: 'edit_file',
    params: {
      path: 'src/login.ts',
      edits: [{ old_string: 'foo', new_string: 'bar' }],
    },
  });
  const event = parseSSEEvent(deferredData);
  deepStrictEqual(event?.type, 'hermes.tool.deferred');
  const def = event as Extract<SSEEvent, { type: 'hermes.tool.deferred' }>;
  deepStrictEqual(def.tool_call_id, 'call_abc123');
  deepStrictEqual(def.tool, 'edit_file');
  deepStrictEqual((def.params as { path: string }).path, 'src/login.ts');
}

// hermes.tool.progress
{
  const data = JSON.stringify({
    type: 'hermes.tool.progress',
    tool_call_id: 'call_xyz',
    status: 'executing',
  });
  const event = parseSSEEvent(data);
  deepStrictEqual(event?.type, 'hermes.tool.progress');
}

// cost
{
  const data = JSON.stringify({
    type: 'cost',
    data: { balance: 5000, used: 123 },
  });
  const event = parseSSEEvent(data);
  deepStrictEqual(event?.type, 'cost');
}

// [DONE] marker
{
  const event = parseSSEEvent('[DONE]');
  deepStrictEqual(event?.type, 'done');
}

// Empty data
{
  const event = parseSSEEvent('');
  deepStrictEqual(event?.type, 'done');
}

// Error event
{
  const data = JSON.stringify({ type: 'error', error: 'Something went wrong' });
  const event = parseSSEEvent(data);
  deepStrictEqual(event?.type, 'error');
}

// Invalid JSON (graceful)
{
  const event = parseSSEEvent('not json');
  deepStrictEqual(event, null);
}

console.log('✅ SSE parsing tests passed');
