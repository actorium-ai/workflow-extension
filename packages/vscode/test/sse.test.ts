/**
 * Unit tests for parseSSEFrame — the pure SSE-frame-to-event mapping used by
 * SseClient. Exercises the real function against the actual wire format
 * hermes-agent's HermesSSETranslator emits (src/streaming/sse.py), not an
 * invented shape.
 */

import { deepStrictEqual } from 'assert';

import { parseSSEFrame } from '../src/chat/sse.js';

// ── chat.completion.chunk (no `event:` line) ────────────────────────────
{
  const events = parseSSEFrame(undefined, {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
  });
  deepStrictEqual(events, [{ kind: 'delta', text: 'Hello' }]);
}

// A role-only or empty-delta frame yields no events.
{
  const events = parseSSEFrame(undefined, {
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });
  deepStrictEqual(events, []);
}

// finish_reason: "error" surfaces the sibling hermes.error message.
{
  const events = parseSSEFrame(undefined, {
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
    hermes: { error: 'boom' },
  });
  deepStrictEqual(events, [{ kind: 'error', message: 'boom' }]);
}

// ── agent.reasoning ──────────────────────────────────────────────────────
{
  const events = parseSSEFrame('agent.reasoning', {
    object: 'reasoning.delta',
    content: 'thinking about it',
  });
  deepStrictEqual(events, [{ kind: 'reasoning', content: 'thinking about it' }]);
}

{
  const events = parseSSEFrame('agent.reasoning', { object: 'reasoning.done' });
  deepStrictEqual(events, [{ kind: 'reasoningDone' }]);
}

// ── hermes.tool.progress ─────────────────────────────────────────────────
{
  const events = parseSSEFrame('hermes.tool.progress', {
    tool: 'edit_file',
    toolCallId: 'call_xyz',
    status: 'running',
  });
  deepStrictEqual(events, [{ kind: 'toolStart', callId: 'call_xyz', name: 'edit_file' }]);
}

{
  const events = parseSSEFrame('hermes.tool.progress', {
    tool: 'edit_file',
    toolCallId: 'call_xyz',
    status: 'completed',
  });
  deepStrictEqual(events, [{ kind: 'toolDone', callId: 'call_xyz', name: 'edit_file' }]);
}

// ── hermes.tool.deferred ─────────────────────────────────────────────────
{
  const events = parseSSEFrame('hermes.tool.deferred', {
    tool_call_id: 'call_abc123',
    tool: 'edit_file',
    params: { path: 'src/login.ts', edits: [{ old_string: 'foo', new_string: 'bar' }] },
  });
  deepStrictEqual(events, [
    {
      kind: 'deferred',
      toolCallId: 'call_abc123',
      tool: 'edit_file',
      params: { path: 'src/login.ts', edits: [{ old_string: 'foo', new_string: 'bar' }] },
    },
  ]);
}

// ── hermes.artifact.saved, hermes.session, and other unknown extension
// events: ignored. hermes.session specifically: the new stateful /chat no
// longer reports session_id back via SSE (the client always already knows
// it, having created the session itself via POST /session before the first
// turn — see SseClient._ensureSession) — so this event should never arrive
// in practice, but if it somehow did, it must not be mistaken for something
// else. ─────────────────────────────────────────────────────────────────
{
  const events = parseSSEFrame('hermes.artifact.saved', { artifact: 'product_spec' });
  deepStrictEqual(events, []);
}

{
  const events = parseSSEFrame('hermes.session', { session_id: 'abc-123' });
  deepStrictEqual(events, []);
}

console.log('✅ SSE parsing tests passed');
