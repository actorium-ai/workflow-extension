package com.hermes.ide.tools

import com.hermes.ide.EditFileParams
import com.hermes.ide.EditOperation
import com.hermes.ide.FileEntry
import com.hermes.ide.ToolResultPayload
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VirtualFile
import java.io.File
import java.nio.file.Files
import java.nio.file.Paths
import java.util.concurrent.TimeUnit
import java.util.stream.Collectors

/**
 * Execute file operation tools using IntelliJ Platform APIs.
 *
 * All edits go through WriteCommandAction for native undo stack support.
 * File creation uses VfsUtil and opens the file in an editor tab.
 */
class FileOps(private val project: Project) {

    /**
     * Read a file and return its content.
     */
    fun readFile(path: String): ToolResultPayload {
        return try {
            val file = resolvePath(path)
            val document = FileDocumentManager.getInstance().getDocument(file)
                ?: return ToolResultPayload(ok = false, error = "Cannot read file: $path (not a text file)")

            ToolResultPayload(ok = true, content = document.text)
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Failed to read file: ${e.message}")
        }
    }

    /**
     * Apply string-replacement edits using WriteCommandAction (native undo stack).
     */
    fun editFile(params: EditFileParams): ToolResultPayload {
        return try {
            val file = resolvePath(params.path)
            val document = FileDocumentManager.getInstance().getDocument(file)
                ?: return ToolResultPayload(ok = false, applied = false, error = "Cannot edit file: ${params.path}")

            var applied = false

            ApplicationManager.getApplication().invokeAndWait {
                WriteCommandAction.runWriteCommandAction(project) {
                    for (op in params.edits) {
                        val text = document.text
                        val index = text.indexOf(op.oldString)

                        if (index == -1) {
                            throw RuntimeException(
                                "Could not find string: \"${op.oldString.take(80)}...\""
                            )
                        }

                        document.replaceString(
                            index,
                            index + op.oldString.length,
                            op.newString
                        )
                        applied = true
                    }
                }
            }

            if (applied) {
                FileDocumentManager.getInstance().saveDocument(document)
                ToolResultPayload(ok = true, applied = true)
            } else {
                ToolResultPayload(ok = false, applied = false, error = "No edits applied")
            }
        } catch (e: Exception) {
            ToolResultPayload(ok = false, applied = false, error = "Failed to edit file: ${e.message}")
        }
    }

    /**
     * Create or overwrite a file, and open it in the editor.
     */
    fun writeFile(path: String, content: String): ToolResultPayload {
        return try {
            val fullPath = resolveAbsolutePath(path)

            // Ensure parent directory exists
            val parentDir = File(fullPath).parentFile
            if (parentDir != null && !parentDir.exists()) {
                parentDir.mkdirs()
            }

            // Write the file
            Files.writeString(Paths.get(fullPath), content)

            // Refresh VFS and open
            ApplicationManager.getApplication().invokeAndWait {
                val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(fullPath)
                if (vf != null) {
                    FileEditorManager.getInstance(project).openFile(vf, true)
                }
            }

            ToolResultPayload(ok = true, applied = true, path = path)
        } catch (e: Exception) {
            ToolResultPayload(ok = false, applied = false, error = "Failed to write file: ${e.message}")
        }
    }

    /**
     * Create a directory.
     */
    fun createDirectory(path: String): ToolResultPayload {
        return try {
            val fullPath = resolveAbsolutePath(path)
            Files.createDirectories(Paths.get(fullPath))

            // Refresh VFS
            LocalFileSystem.getInstance().refreshAndFindFileByPath(fullPath)

            ToolResultPayload(ok = true, path = path)
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Failed to create directory: ${e.message}")
        }
    }

    /**
     * Browse a directory — return list of files and subdirectories.
     */
    fun browseDirectory(path: String): ToolResultPayload {
        return try {
            val vf = resolvePath(path)
            val children = vf.children ?: emptyArray()

            val files = children.sortedWith(
                compareBy<VirtualFile> { if (it.isDirectory) 0 else 1 }
                    .thenBy { it.name }
            ).map { child ->
                FileEntry(
                    name = child.name,
                    path = "${path.removeSuffix("/")}/${child.name}",
                    type = if (child.isDirectory) "directory" else "file",
                )
            }

            ToolResultPayload(ok = true, files = files)
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Failed to browse directory: ${e.message}")
        }
    }

    /**
     * Search file contents using grep/rg.
     */
    fun searchCode(pattern: String, searchPath: String?): ToolResultPayload {
        return try {
            val targetDir = if (searchPath != null) resolveAbsolutePath(searchPath) else project.basePath
                ?: return ToolResultPayload(ok = false, error = "No project base path")

            val process = ProcessBuilder("rg", "--no-heading", "--line-number", "-n", pattern, targetDir)
                .directory(File(targetDir))
                .redirectErrorStream(true)
                .start()

            process.waitFor(30, TimeUnit.SECONDS)
            val output = process.inputStream.bufferedReader().readText()

            if (output.isEmpty() && process.exitValue() == 1) {
                ToolResultPayload(ok = true, content = "(no matches)")
            } else {
                ToolResultPayload(ok = true, content = output.ifEmpty { "(no matches)" })
            }
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Search failed: ${e.message}")
        }
    }

    /**
     * Search files by glob pattern.
     */
    fun searchFiles(pattern: String): ToolResultPayload {
        return try {
            val basePath = project.basePath ?: return ToolResultPayload(ok = false, error = "No project base path")
            val baseDir = File(basePath)

            // Simple glob matching — convert **/*.kt to regex
            val regexPattern = globToRegex(pattern)
            val regex = Regex(regexPattern)

            val matchingFiles = Files.walk(Paths.get(basePath))
                .filter { Files.isRegularFile(it) }
                .filter { regex.matches(it.toString().removePrefix("$basePath/")) }
                .limit(200)
                .map { it.toString() }
                .collect(Collectors.toList())

            ToolResultPayload(
                ok = true,
                content = matchingFiles.joinToString("\n").ifEmpty { "(no matches)" }
            )
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "File search failed: ${e.message}")
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────

    private fun resolvePath(relativePath: String): VirtualFile {
        val fullPath = resolveAbsolutePath(relativePath)
        return LocalFileSystem.getInstance().refreshAndFindFileByPath(fullPath)
            ?: throw RuntimeException("File not found: $fullPath")
    }

    private fun resolveAbsolutePath(relativePath: String): String {
        if (File(relativePath).isAbsolute) {
            return relativePath
        }
        val basePath = project.basePath ?: throw RuntimeException("No project base path")
        return "$basePath/${relativePath.removePrefix("/")}"
    }

    private fun globToRegex(glob: String): String {
        return glob
            .replace(".", "\\.")
            .replace("**", "___DOUBLESTAR___")
            .replace("*", "[^/]*")
            .replace("___DOUBLESTAR___", ".*")
            .replace("?", ".")
    }
}
