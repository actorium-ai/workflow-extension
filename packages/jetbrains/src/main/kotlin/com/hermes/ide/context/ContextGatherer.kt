package com.hermes.ide.context

import com.hermes.ide.DiagnosticInfo
import com.hermes.ide.GitContext
import com.hermes.ide.IDEContext
import com.hermes.ide.TextSelection
import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.codeInsight.daemon.impl.HighlightInfoType
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.components.ProjectComponent
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFileManager
import git4idea.repo.GitRepositoryManager

/**
 * Gathers IDE context for every message sent to the agent.
 * Includes: active file, selection, open files, git status, diagnostics, workspace root.
 *
 * Registered as a ProjectComponent so it has access to the project instance.
 */
class ContextGatherer(private val project: Project) : ProjectComponent {

    /**
     * Gather full IDE context for the current state.
     */
    fun gather(): IDEContext {
        val editor = FileEditorManager.getInstance(project).selectedTextEditor

        val activeFile = editor?.let {
            FileDocumentManager.getInstance().getFile(it.document)
        }?.path

        val selection = getSelection(editor)
        val openFiles = getOpenFiles()
        val workspaceRoot = project.basePath
        val gitStatus = getGitStatus()
        val diagnostics = getDiagnostics(editor)

        return IDEContext(
            activeFile = activeFile,
            selection = selection,
            openFiles = openFiles,
            workspaceRoot = workspaceRoot,
            gitStatus = gitStatus,
            diagnostics = diagnostics,
        )
    }

    /**
     * Read the content of a specific file.
     */
    fun readFile(filePath: String): String? {
        val vf = VirtualFileManager.getInstance().findFileByNioPath(java.nio.file.Path.of(filePath))
            ?: return null
        val document = FileDocumentManager.getInstance().getDocument(vf) ?: return null
        return document.text
    }

    private fun getSelection(editor: Editor?): TextSelection? {
        if (editor == null) return null
        val selectionModel = editor.selectionModel
        if (!selectionModel.hasSelection()) return null

        return TextSelection(
            startLine = editor.document.getLineNumber(selectionModel.selectionStart) + 1,
            endLine = editor.document.getLineNumber(selectionModel.selectionEnd) + 1,
            text = selectionModel.selectedText ?: "",
        )
    }

    private fun getOpenFiles(): List<String> {
        return FileEditorManager.getInstance(project).openFiles.mapNotNull { vf ->
            vf.path
        }
    }

    private fun getGitStatus(): GitContext? {
        return try {
            val repo = GitRepositoryManager.getInstance(project).repositories.firstOrNull()
                ?: return null

            val status = git4idea.GitUtil.getStatusInfo(project, repo.root)

            GitContext(
                branch = repo.currentBranch?.name,
                modified = status.modifiedFiles.map { it.presentableUrl },
                staged = status.stagedFiles.map { it.presentableUrl },
                untracked = status.untrackedFiles.map { it.presentableUrl },
                remoteUrl = repo.remotes.firstOrNull()?.firstUrl,
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun getDiagnostics(editor: Editor?): List<DiagnosticInfo> {
        if (editor == null) return emptyList()

        val vf = FileDocumentManager.getInstance().getFile(editor.document) ?: return emptyList()

        return try {
            val highlights = com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerImpl
                .getHighlights(editor.document, HighlightSeverity.INFORMATION, project)

            highlights.map { highlight ->
                DiagnosticInfo(
                    file = vf.path,
                    line = editor.document.getLineNumber(highlight.startOffset) + 1,
                    column = highlight.startOffset - editor.document.getLineStartOffset(
                        editor.document.getLineNumber(highlight.startOffset)
                    ) + 1,
                    severity = mapSeverity(highlight.severity),
                    message = highlight.description ?: "",
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun mapSeverity(severity: HighlightSeverity): String {
        return when {
            severity >= HighlightSeverity.ERROR -> "error"
            severity >= HighlightSeverity.WARNING -> "warning"
            severity >= HighlightSeverity.INFORMATION -> "info"
            else -> "hint"
        }
    }
}
