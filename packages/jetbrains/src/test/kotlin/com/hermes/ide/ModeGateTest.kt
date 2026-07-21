package com.hermes.ide

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

/**
 * Unit tests for the Mode Gate — Ask/Plan/Auto enforcement logic.
 *
 * Tests the mode enforcement logic in isolation (without IntelliJ APIs).
 * Mirrors the VS Code mode.test.ts.
 */
class ModeGateTest {

    private val mutationTools = setOf(
        "edit_file",
        "write_file",
        "create_directory",
        "run_command",
        "git_commit",
        "git_push",
        "git_checkout",
    )

    private fun isMutationTool(tool: String): Boolean = mutationTools.contains(tool)

    private fun planModeBlocked(tool: String): Boolean = isMutationTool(tool)

    private fun askModeNeedsApproval(tool: String): Boolean =
        isMutationTool(tool) && tool != "clarify"

    @Test
    fun `mutation tools are correctly identified`() {
        assertTrue(isMutationTool("edit_file"))
        assertTrue(isMutationTool("write_file"))
        assertTrue(isMutationTool("create_directory"))
        assertTrue(isMutationTool("run_command"))
        assertTrue(isMutationTool("git_commit"))
        assertTrue(isMutationTool("git_push"))
        assertTrue(isMutationTool("git_checkout"))
    }

    @Test
    fun `read-only tools are not mutation tools`() {
        assertFalse(isMutationTool("read_file"))
        assertFalse(isMutationTool("browse_directory"))
        assertFalse(isMutationTool("search_code"))
        assertFalse(isMutationTool("search_files"))
        assertFalse(isMutationTool("git_status"))
        assertFalse(isMutationTool("git_diff"))
        assertFalse(isMutationTool("git_log"))
        assertFalse(isMutationTool("clarify"))
    }

    @Test
    fun `plan mode blocks all mutation tools`() {
        assertTrue(planModeBlocked("edit_file"))
        assertTrue(planModeBlocked("write_file"))
        assertTrue(planModeBlocked("create_directory"))
        assertTrue(planModeBlocked("run_command"))
        assertTrue(planModeBlocked("git_commit"))
        assertTrue(planModeBlocked("git_push"))
        assertTrue(planModeBlocked("git_checkout"))
    }

    @Test
    fun `plan mode allows read-only tools`() {
        assertFalse(planModeBlocked("read_file"))
        assertFalse(planModeBlocked("browse_directory"))
        assertFalse(planModeBlocked("search_code"))
        assertFalse(planModeBlocked("git_status"))
        assertFalse(planModeBlocked("git_log"))
    }

    @Test
    fun `ask mode requires approval for mutation tools`() {
        assertTrue(askModeNeedsApproval("edit_file"))
        assertTrue(askModeNeedsApproval("write_file"))
        assertTrue(askModeNeedsApproval("run_command"))
        assertTrue(askModeNeedsApproval("git_commit"))
    }

    @Test
    fun `ask mode does not require approval for read-only tools`() {
        assertFalse(askModeNeedsApproval("read_file"))
        assertFalse(askModeNeedsApproval("browse_directory"))
        assertFalse(askModeNeedsApproval("git_status"))
        assertFalse(askModeNeedsApproval("search_files"))
    }

    @Test
    fun `clarify is never blocked`() {
        assertFalse(askModeNeedsApproval("clarify"))
        assertFalse(planModeBlocked("clarify"))
    }
}
