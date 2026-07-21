package com.hermes.ide

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

/**
 * Unit tests for IDE context gathering data structures.
 *
 * Tests context data class behaviour without IntelliJ APIs.
 * Mirrors the VS Code context.test.ts.
 */
class ContextGathererTest {

    @Test
    fun `empty context has null active file`() {
        val context = IDEContext(
            activeFile = null,
            selection = null,
            openFiles = emptyList(),
            workspaceRoot = null,
            gitStatus = null,
            diagnostics = emptyList(),
        )
        assertNull(context.activeFile)
        assertNull(context.workspaceRoot)
        assertEquals(0, context.openFiles.size)
    }

    @Test
    fun `context with selection captures correct lines`() {
        val selection = TextSelection(
            startLine = 42,
            endLine = 72,
            text = "function login(req: LoginRequest) {",
        )
        assertEquals(42, selection.startLine)
        assertEquals(72, selection.endLine)
        assertEquals("function login(req: LoginRequest) {", selection.text)
    }

    @Test
    fun `git context captures branch and changed files`() {
        val gitCtx = GitContext(
            branch = "feature/login-flow",
            modified = listOf("src/login.ts"),
            staged = emptyList(),
            untracked = listOf("src/middleware/"),
            remoteUrl = "https://github.com/org/repo.git",
        )
        assertEquals("feature/login-flow", gitCtx.branch)
        assertEquals(1, gitCtx.modified.size)
        assertEquals("src/login.ts", gitCtx.modified[0])
        assertEquals(1, gitCtx.untracked.size)
        assertEquals("https://github.com/org/repo.git", gitCtx.remoteUrl)
    }

    @Test
    fun `diagnostics capture error severity`() {
        val diag = DiagnosticInfo(
            file = "src/login.ts",
            line = 45,
            column = 10,
            severity = "error",
            message = "Type 'string' is not assignable to type 'LoginRequest'",
        )
        assertEquals("src/login.ts", diag.file)
        assertEquals(45, diag.line)
        assertEquals("error", diag.severity)
        assertEquals("Type 'string' is not assignable to type 'LoginRequest'", diag.message)
    }

    @Test
    fun `full IDE context round-trips all fields`() {
        val context = IDEContext(
            activeFile = "/Users/dev/project/src/login.ts",
            selection = TextSelection(
                startLine = 42,
                endLine = 72,
                text = "function login(req) {",
            ),
            openFiles = listOf("/Users/dev/project/src/login.ts", "/Users/dev/project/src/auth.ts"),
            workspaceRoot = "/Users/dev/project",
            gitStatus = GitContext(
                branch = "feature/login-flow",
                modified = listOf("src/login.ts"),
                staged = emptyList(),
                untracked = emptyList(),
                remoteUrl = "git@github.com:org/repo.git",
            ),
            diagnostics = listOf(
                DiagnosticInfo(
                    file = "src/login.ts",
                    line = 45,
                    column = 10,
                    severity = "error",
                    message = "Missing return type",
                ),
            ),
        )

        assertEquals("/Users/dev/project/src/login.ts", context.activeFile)
        assertEquals(42, context.selection?.startLine)
        assertEquals(2, context.openFiles.size)
        assertEquals("/Users/dev/project", context.workspaceRoot)
        assertEquals("feature/login-flow", context.gitStatus?.branch)
        assertEquals(1, context.diagnostics.size)
    }
}
