package com.hermes.ide.mode

import com.hermes.ide.DeferredToolCall
import com.hermes.ide.OperationalMode
import com.hermes.ide.ToolResultPayload
import com.hermes.ide.tools.ToolExecutor
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ui.Messages

/**
 * Mode gate — enforces Ask/Plan/Auto behaviour for tool execution.
 *
 * Ask:  Show confirmation dialog, wait for user approval
 * Plan: Block all mutation tool calls
 * Auto: Execute immediately without approval
 *
 * The `clarify` tool is never blocked — even in Plan mode.
 */
class ModeGate {
    private var mode: OperationalMode = OperationalMode.ASK

    // Tool categories
    private val mutationTools = setOf(
        "edit_file",
        "write_file",
        "create_directory",
        "run_command",
        "git_commit",
        "git_push",
        "git_checkout",
    )

    fun getMode(): OperationalMode = mode

    fun setMode(mode: OperationalMode) {
        this.mode = mode
    }

    /**
     * Handle a deferred tool call based on the current mode.
     */
    fun handle(
        deferred: DeferredToolCall,
        mode: OperationalMode,
        executor: ToolExecutor,
    ): ToolResultPayload {
        // `clarify` is always allowed regardless of mode
        if (deferred.tool == "clarify") {
            return ToolResultPayload(
                ok = true,
                applied = true,
                content = "Question: ${deferred.params}",
            )
        }

        return when (mode) {
            OperationalMode.AUTO -> executor.execute(deferred.tool, deferred.params)
            OperationalMode.ASK -> handleAsk(deferred, executor)
            OperationalMode.PLAN -> handlePlan(deferred)
        }
    }

    /**
     * Plan mode: block all mutation tools, allow reads.
     */
    private fun handlePlan(deferred: DeferredToolCall): ToolResultPayload {
        if (mutationTools.contains(deferred.tool)) {
            return ToolResultPayload(
                ok = false,
                applied = false,
                error = "Plan mode: tool \"${deferred.tool}\" is blocked. Switch to Ask or Auto mode to execute changes.",
            )
        }

        return ToolResultPayload(
            ok = true,
            content = "[Plan mode] Tool \"${deferred.tool}\" would execute with params: ${deferred.params}",
        )
    }

    /**
     * Ask mode: show a confirmation dialog for mutation tools.
     */
    private fun handleAsk(
        deferred: DeferredToolCall,
        executor: ToolExecutor,
    ): ToolResultPayload {
        val isMutation = mutationTools.contains(deferred.tool)

        if (!isMutation) {
            // Read-only tools execute immediately in Ask mode
            return executor.execute(deferred.tool, deferred.params)
        }

        // Build a human-readable summary
        val summary = formatToolSummary(deferred)

        // Show confirmation
        val result = Messages.showOkCancelDialog(
            "Hermes wants to $summary",
            "Hermes — Approve Change",
            "Approve",
            "Reject",
            Messages.getQuestionIcon(),
        )

        return if (result == Messages.OK) {
            executor.execute(deferred.tool, deferred.params)
        } else {
            ToolResultPayload(
                ok = false,
                applied = false,
                error = "User rejected the change.",
            )
        }
    }

    private fun formatToolSummary(deferred: DeferredToolCall): String {
        val params = deferred.params
        return when (deferred.tool) {
            "edit_file" -> {
                val edits = params["edits"] as? List<*> ?: emptyList<Any>()
                "edit \"${params["path"]}\" (${edits.size} edit(s))"
            }
            "write_file" -> "write \"${params["path"]}\""
            "create_directory" -> "create directory \"${params["path"]}\""
            "run_command" -> "run: ${(params["command"] as? String)?.take(80)}"
            "git_commit" -> "commit: \"${params["message"]}\""
            "git_push" -> "push to remote"
            "git_checkout" -> "checkout \"${params["ref"]}\""
            else -> deferred.tool
        }
    }
}

/**
 * Action: Hermes: Set Mode — changes the operational mode.
 */
class SetModeAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        val modes = arrayOf("Ask", "Plan", "Auto")
        val result = Messages.showChooseDialog(
            project,
            "Select operational mode:",
            "Hermes — Set Mode",
            Messages.getQuestionIcon(),
            modes,
            modes[0],
        )

        if (result != -1) {
            val mode = when (result) {
                0 -> OperationalMode.ASK
                1 -> OperationalMode.PLAN
                2 -> OperationalMode.AUTO
                else -> OperationalMode.ASK
            }
            val toolWindow = com.hermes.ide.HermesToolWindowFactory.instance ?: return
            toolWindow.setMode(mode)
            Messages.showInfoMessage(project, "Mode set to: ${mode.value}", "Hermes")
        }
    }
}
