package com.hermes.ide.tools

import com.hermes.ide.ToolResultPayload
import com.intellij.openapi.project.Project
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Execute terminal commands using the IDE's terminal or process execution.
 *
 * Uses ProcessBuilder for simple commands with output capture.
 * The agent never touches the filesystem — commands execute locally via the IDE.
 */
class TerminalOps(private val project: Project) {

    /**
     * Run a shell command and return its output.
     *
     * Uses ProcessBuilder with configurable working directory.
     * For long-running commands, uses a timeout of 2 minutes.
     */
    fun runCommand(command: String, cwd: String?): ToolResultPayload {
        return try {
            val workingDir = if (cwd != null) {
                File(cwd)
            } else {
                project.basePath?.let { File(it) } ?: File(System.getProperty("user.dir"))
            }

            val process = ProcessBuilder()
                .command("sh", "-c", command)
                .directory(workingDir)
                .redirectErrorStream(true)
                .start()

            val completed = process.waitFor(120, TimeUnit.SECONDS)
            val output = process.inputStream.bufferedReader().readText()

            if (!completed) {
                process.destroyForcibly()
                ToolResultPayload(
                    ok = false,
                    content = output,
                    error = "Command timed out after 120s",
                )
            } else if (process.exitValue() != 0) {
                ToolResultPayload(
                    ok = false,
                    content = output,
                    error = "Command exited with code ${process.exitValue()}",
                )
            } else {
                ToolResultPayload(
                    ok = true,
                    content = output.ifEmpty { "(command completed with no output)" },
                )
            }
        } catch (e: Exception) {
            ToolResultPayload(
                ok = false,
                error = "Command execution failed: ${e.message}",
            )
        }
    }

    /**
     * Run a command in a visible IDE terminal (for interactive use).
     */
    fun runInTerminal(command: String, name: String?) {
        // IntelliJ Terminal tool window integration
        // For now, delegates to ProcessBuilder in a visible way
        val workingDir = project.basePath?.let { File(it) } ?: File(System.getProperty("user.dir"))

        ProcessBuilder()
            .command("sh", "-c", command)
            .directory(workingDir)
            .inheritIO()
            .start()
    }
}
