package com.hermes.ide.chat

import com.hermes.ide.OperationalMode
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.ui.JBColor
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Dimension
import java.awt.Font
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import javax.swing.*
import javax.swing.text.DefaultCaret

/**
 * Chat panel — Swing-based UI for the Hermes chat sidebar.
 *
 * Renders:
 * - Message list (user on right, agent on left)
 * - Mode selector (Ask / Plan / Auto)
 * - Input area with Enter-to-send
 * - Mention autocomplete stub (#, //, @)
 */
class ChatPanel {
    private val panel = JPanel(BorderLayout())
    private val messagesArea = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        font = Font("Monospaced", Font.PLAIN, 13)
        background = JBColor(Color(0x2B, 0x2B, 0x2B), Color(0x2B, 0x2B, 0x2B))
        foreground = JBColor(Color(0xA9, 0xB7, 0xC6), Color(0xA9, 0xB7, 0xC6))
        (caret as DefaultCaret).updatePolicy = DefaultCaret.ALWAYS_UPDATE
    }
    private val messagesScroll = JScrollPane(messagesArea).apply {
        verticalScrollBarPolicy = JScrollPane.VERTICAL_SCROLLBAR_ALWAYS
        border = BorderFactory.createEmptyBorder()
    }

    private val modeSelector = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.X_AXIS)
        background = JBColor(Color(0x3C, 0x3F, 0x41), Color(0x3C, 0x3F, 0x41))
        border = BorderFactory.createEmptyBorder(4, 4, 4, 4)
    }
    private val askBtn = JButton("Ask").apply {
        isOpaque = true
        background = JBColor(Color(0x4C, 0xAF, 0x50), Color(0x4C, 0xAF, 0x50))
        foreground = Color.WHITE
        border = BorderFactory.createEmptyBorder(4, 12, 4, 12)
        font = font.deriveFont(12f)
        addActionListener { onModeChange?.invoke(OperationalMode.ASK) }
    }
    private val planBtn = JButton("Plan").apply {
        isOpaque = true
        background = JBColor(Color(0x55, 0x55, 0x55), Color(0x55, 0x55, 0x55))
        foreground = JBColor(Color(0xA9, 0xB7, 0xC6), Color(0xA9, 0xB7, 0xC6))
        border = BorderFactory.createEmptyBorder(4, 12, 4, 12)
        font = font.deriveFont(12f)
        addActionListener { onModeChange?.invoke(OperationalMode.PLAN) }
    }
    private val autoBtn = JButton("Auto").apply {
        isOpaque = true
        background = JBColor(Color(0x55, 0x55, 0x55), Color(0x55, 0x55, 0x55))
        foreground = JBColor(Color(0xA9, 0xB7, 0xC6), Color(0xA9, 0xB7, 0xC6))
        border = BorderFactory.createEmptyBorder(4, 12, 4, 12)
        font = font.deriveFont(12f)
        addActionListener { onModeChange?.invoke(OperationalMode.AUTO) }
    }

    private val topBar = JPanel(BorderLayout()).apply {
        background = JBColor(Color(0x3C, 0x3F, 0x41), Color(0x3C, 0x3F, 0x41))
        val title = JLabel("  Hermes").apply {
            foreground = JBColor(Color(0xA9, 0xB7, 0xC6), Color(0xA9, 0xB7, 0xC6))
            font = font.deriveFont(Font.BOLD, 14f)
        }
        add(title, BorderLayout.WEST)
        modeSelector.add(askBtn)
        modeSelector.add(Box.createHorizontalStrut(4))
        modeSelector.add(planBtn)
        modeSelector.add(Box.createHorizontalStrut(4))
        modeSelector.add(autoBtn)
        add(modeSelector, BorderLayout.EAST)
    }

    private val inputField = JTextArea(2, 0).apply {
        lineWrap = true
        wrapStyleWord = true
        font = Font("Monospaced", Font.PLAIN, 13)
        background = JBColor(Color(0x3C, 0x3F, 0x41), Color(0x3C, 0x3F, 0x41))
        foreground = JBColor(Color(0xA9, 0xB7, 0xC6), Color(0xA9, 0xB7, 0xC6))
        caretColor = JBColor(Color.WHITE, Color.WHITE)
        border = BorderFactory.createEmptyBorder(8, 8, 8, 8)
        toolTipText = "Ask Hermes... (Shift+Enter for newline, Enter to send)"
    }
    private val inputScroll = JScrollPane(inputField).apply {
        preferredSize = Dimension(0, 60)
        border = BorderFactory.createMatteBorder(1, 0, 0, 0, JBColor(Color(0x55, 0x55, 0x55), Color(0x55, 0x55, 0x55)))
    }
    private val sendButton = JButton("Send").apply {
        isOpaque = true
        background = JBColor(Color(0x4C, 0xAF, 0x50), Color(0x4C, 0xAF, 0x50))
        foreground = Color.WHITE
        border = BorderFactory.createEmptyBorder(8, 16, 8, 16)
        addActionListener { sendMessage() }
    }
    private val inputBar = JPanel(BorderLayout()).apply {
        background = JBColor(Color(0x3C, 0x3F, 0x41), Color(0x3C, 0x3F, 0x41))
        add(inputScroll, BorderLayout.CENTER)
        add(sendButton, BorderLayout.EAST)
    }

    // Callbacks
    var onSendMessage: ((String) -> Unit)? = null
    var onModeChange: ((OperationalMode) -> Unit)? = null

    private var currentMode: OperationalMode = OperationalMode.ASK
    private var isConnected = false

    init {
        panel.add(topBar, BorderLayout.NORTH)
        panel.add(messagesScroll, BorderLayout.CENTER)
        panel.add(inputBar, BorderLayout.SOUTH)

        // Enter to send, Shift+Enter for newline
        inputField.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                if (e.keyCode == KeyEvent.VK_ENTER && !e.isShiftDown) {
                    e.consume()
                    sendMessage()
                }
            }
        })

        // Initial state: show connecting message
        appendSystemMessage("Welcome to Hermes IDE Coding Agent")
        appendSystemMessage("Use the Connect action (Tools → Hermes: Connect) to get started.")
    }

    fun getComponent(): JComponent = panel

    fun setConnected(connected: Boolean) {
        isConnected = connected
        if (connected) {
            appendSystemMessage("✓ Connected")
        } else {
            appendSystemMessage("⚠ Disconnected")
        }
    }

    fun setMode(mode: OperationalMode) {
        currentMode = mode
        updateModeButtons()
        appendSystemMessage("Mode: ${mode.value.replaceFirstChar { it.uppercase() }}")
    }

    fun getMode(): OperationalMode = currentMode

    fun appendText(text: String) {
        SwingUtilities.invokeLater {
            val doc = messagesArea.document
            doc.insertString(doc.length, text, null)
        }
    }

    fun appendAgentMessage(text: String) {
        SwingUtilities.invokeLater {
            messagesArea.append("\n[Agent] $text\n")
        }
    }

    fun appendUserMessage(text: String) {
        SwingUtilities.invokeLater {
            messagesArea.append("\n[You] $text\n")
        }
    }

    fun appendSystemMessage(text: String) {
        SwingUtilities.invokeLater {
            messagesArea.append("\n- $text\n")
        }
    }

    fun showToolProgress(toolCallId: String, status: String) {
        appendSystemMessage("Tool $toolCallId: $status")
    }

    fun clearChat() {
        SwingUtilities.invokeLater {
            messagesArea.text = ""
        }
    }

    fun showAuthPrompt() {
        appendSystemMessage("⚠ Please connect first: Tools → Hermes: Connect")
    }

    private fun sendMessage() {
        val text = inputField.text.trim()
        if (text.isEmpty()) return

        appendUserMessage(text)
        inputField.text = ""
        onSendMessage?.invoke(text)
    }

    private fun updateModeButtons() {
        val activeBg = JBColor(Color(0x4C, 0xAF, 0x50), Color(0x4C, 0xAF, 0x50))
        val inactiveBg = JBColor(Color(0x55, 0x55, 0x55), Color(0x55, 0x55, 0x55))
        val activeFg = Color.WHITE
        val inactiveFg = JBColor(Color(0xA9, 0xB7, 0xC6), Color(0xA9, 0xB7, 0xC6))

        askBtn.background = if (currentMode == OperationalMode.ASK) activeBg else inactiveBg
        askBtn.foreground = if (currentMode == OperationalMode.ASK) activeFg else inactiveFg

        planBtn.background = if (currentMode == OperationalMode.PLAN) activeBg else inactiveBg
        planBtn.foreground = if (currentMode == OperationalMode.PLAN) activeFg else inactiveFg

        autoBtn.background = if (currentMode == OperationalMode.AUTO) activeBg else inactiveBg
        autoBtn.foreground = if (currentMode == OperationalMode.AUTO) activeFg else inactiveFg
    }
}

/**
 * Action: Hermes: Clear Chat — clears the chat panel.
 */
class ClearChatAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val toolWindow = com.hermes.ide.HermesToolWindowFactory.instance ?: return
        toolWindow.clearChat()
    }
}
