package com.hermes.ide.tools

import com.hermes.ide.ToolResultPayload
import com.intellij.openapi.project.Project
import git4idea.GitUtil
import git4idea.commands.Git
import git4idea.commands.GitCommand
import git4idea.commands.GitCommandResult
import git4idea.commands.GitLineHandler
import git4idea.repo.GitRepository
import git4idea.repo.GitRepositoryManager

/**
 * Execute git operations using the IntelliJ Git4Idea plugin API.
 *
 * All operations use the developer's local git state and SSH keys.
 * The agent never touches the filesystem for git — it delegates to the extension.
 */
class GitOps(private val project: Project) {

    /**
     * Get the first git repository for the project.
     */
    private fun getRepo(): GitRepository? {
        return GitRepositoryManager.getInstance(project).repositories.firstOrNull()
    }

    /**
     * Get the current git status.
     */
    fun gitStatus(): ToolResultPayload {
        val repo = getRepo() ?: return ToolResultPayload(ok = false, error = "No git repository found")

        return try {
            val currentBranch = repo.currentBranch?.name ?: "detached"
            val statusInfo = GitUtil.getStatusInfo(project, repo.root)

            val modified = statusInfo.modifiedFiles.map { it.presentableUrl }
            val staged = statusInfo.stagedFiles.map { it.presentableUrl }
            val untracked = statusInfo.untrackedFiles.map { it.presentableUrl }
            val remotes = repo.remotes.map { it.firstUrl ?: "none" }

            val summary = buildString {
                appendLine("Branch: $currentBranch")
                appendLine("Remote: ${remotes.firstOrNull() ?: "none"}")
                appendLine()
                appendLine("Modified (${modified.size}):")
                modified.forEach { appendLine("  M $it") }
                appendLine()
                appendLine("Staged (${staged.size}):")
                staged.forEach { appendLine("  A $it") }
                appendLine()
                appendLine("Untracked (${untracked.size}):")
                untracked.forEach { appendLine("  ? $it") }
            }

            ToolResultPayload(ok = true, content = summary)
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Git status failed: ${e.message}")
        }
    }

    /**
     * Get the working tree diff.
     */
    fun gitDiff(): ToolResultPayload {
        val repo = getRepo() ?: return ToolResultPayload(ok = false, error = "No git repository found")

        return try {
            val handler = GitLineHandler(project, repo.root, GitCommand.DIFF)
            val result = Git.getInstance().runCommand(handler)

            if (result.success()) {
                ToolResultPayload(ok = true, content = result.outputAsJoinedString.ifEmpty { "(no changes)" })
            } else {
                ToolResultPayload(ok = false, error = "Git diff failed: ${result.errorOutputAsJoinedString}")
            }
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Git diff failed: ${e.message}")
        }
    }

    /**
     * Commit changes with a message.
     */
    fun gitCommit(message: String): ToolResultPayload {
        val repo = getRepo() ?: return ToolResultPayload(ok = false, error = "No git repository found")

        return try {
            val handler = GitLineHandler(project, repo.root, GitCommand.COMMIT)
            handler.addParameters("-m", message)
            val result = Git.getInstance().runCommand(handler)

            if (result.success()) {
                ToolResultPayload(ok = true, content = "Committed: $message")
            } else {
                ToolResultPayload(ok = false, error = "Git commit failed: ${result.errorOutputAsJoinedString}")
            }
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Git commit failed: ${e.message}")
        }
    }

    /**
     * Push commits to the remote.
     */
    fun gitPush(branch: String?): ToolResultPayload {
        val repo = getRepo() ?: return ToolResultPayload(ok = false, error = "No git repository found")

        return try {
            val handler = GitLineHandler(project, repo.root, GitCommand.PUSH)
            handler.addParameters("origin")
            if (branch != null) {
                handler.addParameters(branch)
            } else {
                handler.addParameters(repo.currentBranch?.name ?: "main")
            }

            val result = Git.getInstance().runCommand(handler)

            if (result.success()) {
                ToolResultPayload(ok = true, content = "Push successful")
            } else {
                ToolResultPayload(ok = false, error = "Git push failed: ${result.errorOutputAsJoinedString}")
            }
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Git push failed: ${e.message}")
        }
    }

    /**
     * Checkout a branch or commit.
     */
    fun gitCheckout(ref: String): ToolResultPayload {
        val repo = getRepo() ?: return ToolResultPayload(ok = false, error = "No git repository found")

        return try {
            val handler = GitLineHandler(project, repo.root, GitCommand.CHECKOUT)
            handler.addParameters(ref)
            val result = Git.getInstance().runCommand(handler)

            if (result.success()) {
                ToolResultPayload(ok = true, content = "Checked out: $ref")
            } else {
                ToolResultPayload(ok = false, error = "Git checkout failed: ${result.errorOutputAsJoinedString}")
            }
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Git checkout failed: ${e.message}")
        }
    }

    /**
     * Show git log.
     */
    fun gitLog(maxEntries: Int): ToolResultPayload {
        val repo = getRepo() ?: return ToolResultPayload(ok = false, error = "No git repository found")

        return try {
            val handler = GitLineHandler(project, repo.root, GitCommand.LOG)
            handler.addParameters("--oneline", "-n", maxEntries.toString())
            val result = Git.getInstance().runCommand(handler)

            if (result.success()) {
                ToolResultPayload(
                    ok = true,
                    content = result.outputAsJoinedString.ifEmpty { "(no commits)" }
                )
            } else {
                ToolResultPayload(ok = false, error = "Git log failed: ${result.errorOutputAsJoinedString}")
            }
        } catch (e: Exception) {
            ToolResultPayload(ok = false, error = "Git log failed: ${e.message}")
        }
    }
}
