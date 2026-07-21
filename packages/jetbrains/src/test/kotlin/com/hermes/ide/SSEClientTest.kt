package com.hermes.ide

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

/**
 * Unit tests for SSE event parsing.
 *
 * Tests the SSE event type detection and parsing logic
 * in isolation from network I/O.
 * Mirrors the VS Code sse.test.ts.
 */
class SSEClientTest {

    private data class ParsedEvent(
        val type: String,
        val content: String? = null,
        val toolCallId: String? = null,
        val tool: String? = null,
        val params: Map<String, Any>? = null,
        val status: String? = null,
        val error: String? = null,
        val data: Map<String, Any>? = null,
    )

    private fun parseSSEEvent(data: String): ParsedEvent? {
        if (data.isEmpty() || data == "[DONE]") {
            return ParsedEvent(type = "done")
        }

        return try {
            val regex = Regex("\"([^\"]+)\"\\s*:\\s*(\"[^\"]*\"|\\d+|true|false|null|\\{[^}]*\\}|\\[[^\\]]*\\])")
            val pairs = regex.findAll(data).map { match ->
                val key = match.groupValues[1]
                val value = match.groupValues[2]
                key to value
            }.toMap()

            // Extract the type field
            val type = data.substringAfter("\"type\":\"").substringBefore("\"")
            val content = data.substringAfter("\"content\":\"").substringBefore("\"").takeIf { it.isNotEmpty() && data.contains("\"content\"") }
            val toolCallId = data.substringAfter("\"tool_call_id\":\"").substringBefore("\"").takeIf { it.isNotEmpty() && data.contains("\"tool_call_id\"") }
            val tool = data.substringAfter("\"tool\":\"").substringBefore("\"").takeIf { it.isNotEmpty() && data.contains("\"tool\"") }
            val error = data.substringAfter("\"error\":\"").substringBefore("\"").takeIf { it.isNotEmpty() && data.contains("\"error\"") }

            ParsedEvent(
                type = type,
                content = content,
                toolCallId = toolCallId,
                tool = tool,
                error = error,
            )
        } catch (_: Exception) {
            null
        }
    }

    @Test
    fun `parses chat completion chunk`() {
        val event = parseSSEEvent("""{"type":"chat.completion.chunk","content":"Hello"}""")
        assertNotNull(event)
        assertEquals("chat.completion.chunk", event!!.type)
        assertEquals("Hello", event.content)
    }

    @Test
    fun `parses deferred tool call`() {
        val data = """{"type":"hermes.tool.deferred","tool_call_id":"call_abc123","tool":"edit_file","params":{"path":"src/login.ts","edits":[{"old_string":"foo","new_string":"bar"}]}}"""
        val event = parseSSEEvent(data)
        assertNotNull(event)
        assertEquals("hermes.tool.deferred", event!!.type)
        assertEquals("call_abc123", event.toolCallId)
        assertEquals("edit_file", event.tool)
    }

    @Test
    fun `parses tool progress`() {
        val data = """{"type":"hermes.tool.progress","tool_call_id":"call_xyz","status":"executing"}"""
        val event = parseSSEEvent(data)
        assertNotNull(event)
        assertEquals("hermes.tool.progress", event!!.type)
    }

    @Test
    fun `parses cost event`() {
        val data = """{"type":"cost","data":{"balance":5000,"used":123}}"""
        val event = parseSSEEvent(data)
        assertNotNull(event)
        assertEquals("cost", event!!.type)
    }

    @Test
    fun `DONE marker returns done type`() {
        val event = parseSSEEvent("[DONE]")
        assertNotNull(event)
        assertEquals("done", event!!.type)
    }

    @Test
    fun `empty data returns done type`() {
        val event = parseSSEEvent("")
        assertNotNull(event)
        assertEquals("done", event!!.type)
    }

    @Test
    fun `parses error event`() {
        val data = """{"type":"error","error":"Something went wrong"}"""
        val event = parseSSEEvent(data)
        assertNotNull(event)
        assertEquals("error", event!!.type)
    }

    @Test
    fun `invalid JSON returns null gracefully`() {
        val event = parseSSEEvent("not json")
        assertNull(event)
    }
}
