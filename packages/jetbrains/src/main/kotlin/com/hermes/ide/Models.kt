package com.hermes.ide

/**
 * Shared data models for the Hermes IDE Coding Agent JetBrains extension.
 *
 * Mirrors the TypeScript types in @workflow-extension/shared.
 */

// ── Chat message types ──────────────────────────────────────────────────

data class ChatMessage(
    val role: String,        // "user" | "assistant" | "system" | "tool"
    val content: String?,
    val toolCallId: String? = null,
    val name: String? = null,
)

// ── Tool call / tool result ─────────────────────────────────────────────

data class ToolCall(
    val toolCallId: String,
    val tool: String,
    val params: Map<String, Any>,
)

data class ToolResultPayload(
    val ok: Boolean?,
    val applied: Boolean? = null,
    val content: String? = null,
    val error: String? = null,
    val files: List<FileEntry>? = null,
    val path: String? = null,
)

data class FileEntry(
    val name: String,
    val path: String,
    val type: String,  // "file" | "directory"
)

// ── Deferred tool execution ─────────────────────────────────────────────

data class DeferredToolCall(
    val type: String = "hermes.tool.deferred",
    val toolCallId: String,
    val tool: String,
    val params: Map<String, Any>,
)

// ── IDE context ─────────────────────────────────────────────────────────

data class IDEContext(
    val activeFile: String?,
    val selection: TextSelection?,
    val openFiles: List<String>,
    val workspaceRoot: String?,
    val gitStatus: GitContext?,
    val diagnostics: List<DiagnosticInfo>,
)

data class TextSelection(
    val startLine: Int,
    val endLine: Int,
    val text: String,
)

data class GitContext(
    val branch: String?,
    val modified: List<String>,
    val staged: List<String>,
    val untracked: List<String>,
    val remoteUrl: String?,
)

data class DiagnosticInfo(
    val file: String,
    val line: Int,
    val column: Int,
    val severity: String,  // "error" | "warning" | "info" | "hint"
    val message: String,
)

// ── Version management ──────────────────────────────────────────────────

data class VersionInfo(
    val vscode: VersionEntry,
    val jetbrains: VersionEntry,
)

data class VersionEntry(
    val minVersion: String,
    val recommendedVersion: String,
    val marketplaceUrl: String,
    val deprecationNotice: String?,
)

// ── OAuth / Auth ────────────────────────────────────────────────────────

data class DeviceCodeResponse(
    val deviceCode: String,
    val userCode: String,
    val verificationUri: String,
    val verificationUriComplete: String,
    val expiresIn: Int,
    val interval: Int,
)

data class TokenResponse(
    val accessToken: String,
    val tokenType: String,
    val expiresIn: Int,
    val refreshToken: String?,
)

// ── Credit display ──────────────────────────────────────────────────────

data class CreditInfo(
    val balance: Double,
    val used: Double,
    val limit: Double?,
)

// ── Edit payload ────────────────────────────────────────────────────────

data class EditOperation(
    val oldString: String,
    val newString: String,
)

data class EditFileParams(
    val path: String,
    val edits: List<EditOperation>,
)

// ── Operational mode ────────────────────────────────────────────────────

enum class OperationalMode(val value: String) {
    ASK("ask"),
    PLAN("plan"),
    AUTO("auto");

    companion object {
        fun fromString(s: String): OperationalMode =
            entries.firstOrNull { it.value == s } ?: ASK
    }
}
