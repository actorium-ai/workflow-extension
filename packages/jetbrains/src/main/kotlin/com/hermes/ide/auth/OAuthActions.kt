package com.hermes.ide.auth

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ui.Messages

/**
 * Action: Hermes: Connect — initiates OAuth device flow.
 */
class OAuthConnectAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val properties = com.intellij.ide.util.PropertiesComponent.getInstance()

        val userServiceUrl = properties.getValue("hermes.userServiceUrl")
            ?: "https://api.nousresearch.com"
        val clientId = properties.getValue("hermes.clientId")
            ?: "hermes-jetbrains"

        try {
            OAuthDeviceFlow.getInstance().startDeviceFlow(userServiceUrl, clientId)
            Messages.showInfoMessage(
                project,
                "Hermes device flow started. Check your browser to complete authentication.",
                "Hermes Connect"
            )
        } catch (ex: Exception) {
            Messages.showErrorDialog(
                project,
                "OAuth flow failed: ${ex.message}",
                "Hermes Auth Error"
            )
        }
    }
}

/**
 * Action: Hermes: Disconnect — clears stored token.
 */
class OAuthDisconnectAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        OAuthDeviceFlow.getInstance().disconnect()
        Messages.showInfoMessage(project, "Disconnected from Hermes.", "Hermes")
    }
}
