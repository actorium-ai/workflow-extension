package com.hermes.ide

import com.hermes.ide.auth.OAuthDeviceFlow
import com.hermes.ide.chat.ChatPanel
import com.hermes.ide.chat.SSEClient
import com.hermes.ide.context.ContextGatherer
import com.hermes.ide.mode.ModeGate
import com.hermes.ide.status.CreditsWidget
import com.hermes.ide.tools.ToolExecutor
import com.hermes.ide.version.VersionChecker
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

/**
 * Main tool window factory for the Hermes IDE Coding Agent.
 *
 * Registered in plugin.xml as a toolWindow factory.
 * This is the equivalent of extension.ts in the VS Code extension —
 * it wires together all modules and handles the lifecycle.
 */
class HermesToolWindowFactory : ToolWindowFactory {

    companion object {
        @Volatile
        var instance: HermesToolWindowFactory? = null
            private set
    }

    private var chatPanel: ChatPanel? = null
    private var sseClient: SSEClient? = null
    private var toolExecutor: ToolExecutor? = null
    private var modeGate: ModeGate? = null
    private var contextGatherer: ContextGatherer? = null
    private var creditsWidget: CreditsWidget? = null

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        instance = this

        // ── 1. Initialize modules ──────────────────────────────────────────
        val authManager = OAuthDeviceFlow.getInstance()
        modeGate = ModeGate()
        contextGatherer = ContextGatherer(project)

        val defaultMode = OperationalMode.fromString(
            PropertiesComponent.getInstance().getValue("hermes.mode") ?: "ask"
        )
        modeGate?.setMode(defaultMode)

        toolExecutor = ToolExecutor(project)

        sseClient = SSEClient(
            tokenProvider = { authManager.getToken() }
        ).apply {
            // Wire SSE events to the mode gate → tool executor
            onDeferredToolCall = { deferred ->
                val currentMode = modeGate?.getMode() ?: OperationalMode.ASK
                val executor = toolExecutor ?: return@apply
                val result = modeGate?.handle(deferred, currentMode, executor)
                    ?: ToolResultPayload(ok = false, error = "Mode gate unavailable")

                // Send result back to agent
                sseClient?.sendToolResult(deferred.toolCallId, deferred.tool, result)
            }

            onProgress = { toolCallId, status ->
                chatPanel?.showToolProgress(toolCallId, status)
            }

            onCost = { creditInfo ->
                creditsWidget?.update(creditInfo)
            }
        }

        // ── 2. Chat panel ─────────────────────────────────────────────────
        chatPanel = ChatPanel().apply {
            onSendMessage = { message ->
                val token = authManager.getToken()
                if (token == null) {
                    showAuthPrompt()
                    return@apply
                }

                val ideContext = contextGatherer?.gather()
                    ?: IDEContext(
                        activeFile = null,
                        selection = null,
                        openFiles = emptyList(),
                        workspaceRoot = null,
                        gitStatus = null,
                        diagnostics = emptyList(),
                    )

                val properties = PropertiesComponent.getInstance()
                val agentUrl = properties.getValue("hermes.agentUrl")
                    ?: "https://agent.nousresearch.com"

                val mode = modeGate?.getMode() ?: OperationalMode.ASK

                // Set text callback for streaming output
                sseClient?.onText = { text ->
                    chatPanel?.appendText(text)
                }

                sseClient?.sendMessage(agentUrl, message, ideContext, mode)
            }

            onModeChange = { mode ->
                modeGate?.setMode(mode)
                setMode(mode)
            }
        }

        // Add the chat panel to the tool window
        val content = ContentFactory.getInstance().createContent(
            chatPanel?.getComponent(),
            "",
            false,
        )
        toolWindow.contentManager.addContent(content)

        // ── 3. Auto-connect if token exists ────────────────────────────────
        if (authManager.autoConnect()) {
            chatPanel?.setConnected(true)
        }

        // ── 4. Version check ───────────────────────────────────────────────
        ApplicationManager.getApplication()
            .getComponent(VersionChecker::class.java)
            .autoCheck()
    }

    override fun shouldBeAvailable(project: Project): Boolean = true

    fun setMode(mode: OperationalMode) {
        chatPanel?.setMode(mode)
    }

    fun clearChat() {
        chatPanel?.clearChat()
        sseClient?.clearMessages()
    }
}
