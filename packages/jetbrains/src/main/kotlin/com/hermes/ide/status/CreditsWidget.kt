package com.hermes.ide.status

import com.hermes.ide.CreditInfo
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.openapi.wm.impl.status.EditorBasedWidget
import com.intellij.util.Consumer
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JLabel

/**
 * Credit status bar widget — shows Hermes credit balance in the IDE status bar.
 *
 * Mirrors the VS Code status bar credits display.
 */
class CreditsWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = "hermesCredits"

    override fun getDisplayName(): String = "Hermes Credits"

    override fun isAvailable(project: Project): Boolean = true

    override fun createWidget(project: Project): StatusBarWidget {
        return CreditsWidget(project)
    }

    override fun disposeWidget(widget: StatusBarWidget) {
        // No-op
    }
}

class CreditsWidget(private val project: Project) : StatusBarWidget, StatusBarWidget.TextPresentation {
    private var label: JLabel = JLabel("Hermes")

    init {
        label.toolTipText = "Hermes IDE Coding Agent"
    }

    override fun ID(): String = "hermesCredits"

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun getText(): String = label.text ?: "Hermes"

    override fun getAlignment(): Float = 1.0f // Right-aligned

    override fun getTooltipText(): String = label.toolTipText ?: ""

    override fun getClickConsumer(): Consumer<MouseEvent>? = null

    /**
     * Update the credit display.
     */
    fun update(info: CreditInfo) {
        label.text = "Hermes: ${info.balance.toLong().toString().let { formatWithCommas(it) }} credits"
        label.toolTipText = buildString {
            append("Balance: ${formatWithCommas(info.balance.toLong().toString())}")
            if (info.used > 0) {
                append(" | Used this session: ${formatWithCommas(info.used.toLong().toString())}")
            }
        }
    }

    /**
     * Show as connected.
     */
    fun showConnected() {
        label.text = "Hermes ✓"
        label.toolTipText = "Hermes IDE Coding Agent — connected"
    }

    fun showDisconnected() {
        label.text = "Hermes"
        label.toolTipText = "Hermes IDE Coding Agent — click to connect"
    }

    private fun formatWithCommas(value: String): String {
        return value.reversed()
            .chunked(3)
            .joinToString(",")
            .reversed()
    }
}
