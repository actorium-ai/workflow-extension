package com.hermes.ide.chat

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.hermes.ide.ChatMessage
import com.hermes.ide.CreditInfo
import com.hermes.ide.DeferredToolCall
import com.hermes.ide.IDEContext
import com.hermes.ide.OperationalMode
import com.hermes.ide.ToolResultPayload
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

/**
 * SSE client for the hermes-agent coding chat endpoint (JetBrains).
 *
 * Sends POST /api/v1/coding/chat with SSE streaming response.
 * Parses SSE events: chat.completion.chunk, hermes.tool.deferred,
 * hermes.tool.progress, cost, done, error.
 */
class SSEClient(
    private val tokenProvider: () -> String?,
) {
    private val gson = Gson()
    private val messages = mutableListOf<ChatMessage>()
    private var currentCall: Call? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    // Callbacks
    var onText: ((String) -> Unit)? = null
    var onDeferredToolCall: ((DeferredToolCall) -> Unit)? = null
    var onProgress: ((String, String) -> Unit)? = null
    var onCost: ((CreditInfo) -> Unit)? = null

    /**
     * Send a user message to the agent and stream the response.
     */
    fun sendMessage(
        agentUrl: String,
        content: String,
        context: IDEContext,
        mode: OperationalMode,
    ) {
        // Append user message
        messages.add(ChatMessage(role = "user", content = content))

        streamRequest(agentUrl, context, mode)
    }

    /**
     * Send a tool result back to the agent and continue the stream.
     */
    fun sendToolResult(toolCallId: String, tool: String, result: ToolResultPayload) {
        val token = tokenProvider() ?: return

        // Append tool result
        messages.add(
            ChatMessage(
                role = "tool",
                content = gson.toJson(result),
                toolCallId = toolCallId,
                name = tool,
            )
        )

        // Continue with empty context for subsequent tool-result turns
        val emptyContext = IDEContext(
            activeFile = null,
            selection = null,
            openFiles = emptyList(),
            workspaceRoot = null,
            gitStatus = null,
            diagnostics = emptyList(),
        )
        streamRequest("", emptyContext, OperationalMode.AUTO)
    }

    /**
     * Internal: POST to the SSE endpoint and parse the event stream.
     */
    private fun streamRequest(
        agentUrl: String,
        context: IDEContext,
        mode: OperationalMode,
    ) {
        val token = tokenProvider()
        if (token == null) {
            onText?.invoke("\n⚠️ Not authenticated. Please connect first.\n")
            return
        }

        val body = mapOf(
            "messages" to messages,
            "workspace_id" to null,
            "feature_id" to null,
            "repo_path" to context.workspaceRoot,
            "context" to context,
            "mode" to mode.value,
        )

        val jsonBody = gson.toJson(body)
        val mediaType = "application/json; charset=utf-8".toMediaType()

        val request = Request.Builder()
            .url("$agentUrl/api/v1/coding/chat")
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .post(jsonBody.toRequestBody(mediaType))
            .build()

        Thread {
            try {
                val response = client.newCall(request).execute()

                if (response.code == 401) {
                    onText?.invoke("\n⚠️ Authentication expired. Please reconnect.\n")
                    return@Thread
                }
                if (!response.isSuccessful) {
                    onText?.invoke("\n⚠️ Error ${response.code}: ${response.message}\n")
                    return@Thread
                }

                val bodyStream = response.body?.byteStream() ?: run {
                    onText?.invoke("\n⚠️ No response body\n")
                    return@Thread
                }

                val reader = BufferedReader(InputStreamReader(bodyStream))
                var line: String?
                var assistantContent = StringBuilder()

                while (reader.readLine().also { line = it } != null) {
                    val currentLine = line ?: continue

                    if (currentLine.startsWith("data: ")) {
                        val data = currentLine.removePrefix("data: ").trim()
                        if (data.isEmpty() || data == "[DONE]") continue

                        try {
                            val parsed = JsonParser.parseString(data).asJsonObject

                            val eventType = parsed.get("type")?.asString ?: continue

                            when (eventType) {
                                "chat.completion.chunk" -> {
                                    val content = parsed.get("content")?.asString ?: ""
                                    assistantContent.append(content)
                                    onText?.invoke(content)
                                }

                                "hermes.tool.deferred" -> {
                                    // Flush accumulated assistant text
                                    if (assistantContent.isNotEmpty()) {
                                        messages.add(
                                            ChatMessage(role = "assistant", content = assistantContent.toString())
                                        )
                                        assistantContent = StringBuilder()
                                    }

                                    val toolCallId = parsed.get("tool_call_id")?.asString ?: ""
                                    val tool = parsed.get("tool")?.asString ?: ""
                                    val params = gson.fromJson(
                                        parsed.get("params")?.toString() ?: "{}",
                                        Map::class.java
                                    ) as Map<String, Any>

                                    // Push a placeholder assistant message for the tool call
                                    messages.add(
                                        ChatMessage(
                                            role = "assistant",
                                            content = null,
                                            toolCallId = toolCallId,
                                            name = tool,
                                        )
                                    )

                                    onDeferredToolCall?.invoke(
                                        DeferredToolCall(
                                            toolCallId = toolCallId,
                                            tool = tool,
                                            params = params,
                                        )
                                    )
                                }

                                "hermes.tool.progress" -> {
                                    val tid = parsed.get("tool_call_id")?.asString ?: ""
                                    val status = parsed.get("status")?.asString ?: ""
                                    onProgress?.invoke(tid, status)
                                }

                                "cost" -> {
                                    val dataObj = parsed.getAsJsonObject("data")
                                    val creditInfo = gson.fromJson(dataObj, CreditInfo::class.java)
                                    onCost?.invoke(creditInfo)
                                }

                                "error" -> {
                                    val error = parsed.get("error")?.asString ?: "Unknown error"
                                    onText?.invoke("\n⚠️ $error\n")
                                }
                            }
                        } catch (_: Exception) {
                            // Non-JSON data — handle as raw text chunk
                            onText?.invoke(data)
                            assistantContent.append(data)
                        }
                    }
                }

                // Flush any remaining text
                if (assistantContent.isNotEmpty()) {
                    messages.add(
                        ChatMessage(role = "assistant", content = assistantContent.toString())
                    )
                }
            } catch (e: Exception) {
                onText?.invoke("\n⚠️ Connection error: ${e.message}\n")
            }
        }.start()
    }

    /**
     * Cancel the current streaming request.
     */
    fun cancel() {
        currentCall?.cancel()
    }

    /**
     * Clear the message history.
     */
    fun clearMessages() {
        messages.clear()
    }

    /**
     * Dispose the client.
     */
    fun dispose() {
        cancel()
    }
}
