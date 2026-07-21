package com.hermes.ide.tools

import com.hermes.ide.EditFileParams
import com.hermes.ide.ToolResultPayload
import com.intellij.openapi.project.Project

/**
 * Routes deferred tool calls from the agent to the correct executor.
 *
 * Each tool handler receives the params from the agent and returns a ToolResultPayload.
 * The SSE client sends this result back to the agent for the next turn.
 */
class ToolExecutor(private val project: Project) {
    private val fileOps = FileOps(project)
    private val terminalOps = TerminalOps(project)
    private val gitOps = GitOps(project)

    /**
     * Execute a tool call by name.
     *
     * Returns the result payload to be sent back to the agent.
     */
    @Suppress("UNCHECKED_CAST")
    fun execute(tool: String, params: Map<String, Any>): ToolResultPayload {
        return when (tool) {
            // ── File operations ──────────────────────────────────────
            "read_file" -> fileOps.readFile(params["path"] as String)

            "edit_file" -> {
                val editParams = parseEditFileParams(params)
                fileOps.editFile(editParams)
            }

            "write_file" -> fileOps.writeFile(
                params["path"] as String,
                params["content"] as String,
            )

            "create_directory" -> fileOps.createDirectory(params["path"] as String)

            "browse_directory" -> fileOps.browseDirectory(params["path"] as String)

            "search_code" -> fileOps.searchCode(
                params["pattern"] as String,
                params["path"] as? String,
            )

            "search_files" -> fileOps.searchFiles(params["pattern"] as String)

            // ── Terminal operations ──────────────────────────────────
            "run_command" -> terminalOps.runCommand(
                params["command"] as String,
                params["cwd"] as? String,
            )

            // ── Git operations ───────────────────────────────────────
            "git_status" -> gitOps.gitStatus()
            "git_diff" -> gitOps.gitDiff()
            "git_commit" -> gitOps.gitCommit(params["message"] as String)
            "git_push" -> gitOps.gitPush(params["branch"] as? String)
            "git_checkout" -> gitOps.gitCheckout(params["ref"] as String)
            "git_log" -> gitOps.gitLog((params["max_entries"] as? Double)?.toInt() ?: 20)

            // ── Unknown tool ─────────────────────────────────────────
            else -> ToolResultPayload(
                ok = false,
                error = "Unknown tool: $tool",
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseEditFileParams(params: Map<String, Any>): EditFileParams {
        val path = params["path"] as String
        val editsRaw = params["edits"] as List<Map<String, Any>>
        val edits = editsRaw.map { edit ->
            com.hermes.ide.EditOperation(
                oldString = edit["old_string"] as String,
                newString = edit["new_string"] as String,
            )
        }
        return EditFileParams(path = path, edits = edits)
    }
}
