package com.hermes.ide

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

/**
 * Unit tests for tool result payload structures.
 *
 * Tests the ToolResultPayload and related data class shapes.
 * Mirrors the VS Code tools.test.ts.
 */
class ToolsTest {

    @Test
    fun `successful file read result`() {
        val result = ToolResultPayload(
            ok = true,
            content = """export function hello() { return "world"; }""",
        )
        assertEquals(true, result.ok)
        assertEquals(43, result.content?.length)
        assertNull(result.error)
    }

    @Test
    fun `failed file read result`() {
        val result = ToolResultPayload(
            ok = false,
            error = "File not found: src/missing.ts",
        )
        assertEquals(false, result.ok)
        assertEquals("File not found: src/missing.ts", result.error)
    }

    @Test
    fun `successful edit result`() {
        val result = ToolResultPayload(
            ok = true,
            applied = true,
        )
        assertEquals(true, result.ok)
        assertEquals(true, result.applied)
    }

    @Test
    fun `rejected edit result`() {
        val result = ToolResultPayload(
            ok = false,
            applied = false,
            error = "User rejected the change.",
        )
        assertEquals(false, result.ok)
        assertEquals(false, result.applied)
    }

    @Test
    fun `deferred tool call — ok is null`() {
        val result = ToolResultPayload(
            ok = null,
            path = "src/middleware/",
        )
        assertNull(result.ok)
        assertEquals("src/middleware/", result.path)
    }

    @Test
    fun `directory browse result`() {
        val result = ToolResultPayload(
            ok = true,
            files = listOf(
                FileEntry(name = "login.ts", path = "src/login.ts", type = "file"),
                FileEntry(name = "middleware", path = "src/middleware", type = "directory"),
            ),
        )
        assertEquals(true, result.ok)
        assertEquals(2, result.files?.size)
        assertEquals("file", result.files?.get(0)?.type)
        assertEquals("directory", result.files?.get(1)?.type)
    }

    @Test
    fun `command result with error`() {
        val result = ToolResultPayload(
            ok = false,
            content = "npm ERR! missing script: build",
            error = "Command failed with exit code 1",
        )
        assertEquals(false, result.ok)
        assertTrue(result.content?.contains("npm ERR!") == true)
    }
}
