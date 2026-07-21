package com.hermes.ide.version

import com.google.gson.Gson
import com.hermes.ide.VersionInfo
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.ApplicationComponent
import com.intellij.openapi.ui.Messages
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Version checker — polls GET /api/v1/coding/version on activation and
 * every 6 hours. Enforces min_version (hard block) and recommended_version
 * (soft nudge with 24h suppress).
 */
class VersionChecker : ApplicationComponent {
    private val gson = Gson()
    private val httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()

    private val EXTENSION_VERSION = "0.1.0"

    companion object {
        private const val CHECK_INTERVAL_HOURS = 6L
        private const val NUDGE_SUPPRESS_KEY = "hermes.versionNudgeSuppressedUntil"
    }

    override fun initComponent() {
        autoCheck()
    }

    /**
     * Begin periodic version checks.
     */
    fun autoCheck() {
        checkNow()
        scheduler.scheduleAtFixedRate(
            { checkNow() },
            CHECK_INTERVAL_HOURS,
            CHECK_INTERVAL_HOURS,
            TimeUnit.HOURS,
        )
    }

    /**
     * Check the version endpoint immediately.
     */
    fun checkNow() {
        val properties = PropertiesComponent.getInstance()
        val agentUrl = properties.getValue("hermes.agentUrl") ?: return

        try {
            val request = HttpRequest.newBuilder()
                .uri(URI.create("$agentUrl/api/v1/coding/version"))
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(10))
                .GET()
                .build()

            val resp = httpClient.send(request, HttpResponse.BodyHandlers.ofString())

            if (resp.statusCode() != 200) return

            val versionInfo = gson.fromJson(resp.body(), VersionInfo::class.java)
            evaluate(versionInfo.jetbrains)
        } catch (_: Exception) {
            // Fail-open on network errors — just log and continue
        }
    }

    /**
     * Evaluate the version entry from the backend.
     */
    private fun evaluate(entry: com.hermes.ide.VersionEntry) {
        val installed = EXTENSION_VERSION

        // Hard block
        if (compareVersions(installed, entry.minVersion) < 0) {
            showBlockingBanner(entry)
            return
        }

        // Soft nudge (check suppression)
        val properties = PropertiesComponent.getInstance()
        val suppressed = properties.getLong(NUDGE_SUPPRESS_KEY, 0L)
        if (suppressed > 0 && System.currentTimeMillis() < suppressed) {
            return
        }

        if (compareVersions(installed, entry.recommendedVersion) < 0) {
            showUpdateNudge(entry)
        }
    }

    private fun showBlockingBanner(entry: com.hermes.ide.VersionEntry) {
        ApplicationManager.getApplication().invokeLater {
            val result = Messages.showDialog(
                "Hermes: This extension version ($EXTENSION_VERSION) is no longer " +
                    "compatible with the backend (min: ${entry.minVersion}). Update to continue.",
                "Hermes — Update Required",
                arrayOf("Update"),
                0,
                Messages.getErrorIcon(),
            )

            if (result == 0) {
                val desktop = java.awt.Desktop.getDesktop()
                if (desktop.isSupported(java.awt.Desktop.Action.BROWSE)) {
                    desktop.browse(URI(entry.marketplaceUrl))
                }
            }
        }
    }

    private fun showUpdateNudge(entry: com.hermes.ide.VersionEntry) {
        ApplicationManager.getApplication().invokeLater {
            val result = Messages.showDialog(
                "Hermes v${entry.recommendedVersion} is available " +
                    "(you have $EXTENSION_VERSION).",
                "Hermes — Update Available",
                arrayOf("Update Now", "Later"),
                0,
                Messages.getQuestionIcon(),
            )

            when (result) {
                0 -> {
                    val desktop = java.awt.Desktop.getDesktop()
                    if (desktop.isSupported(java.awt.Desktop.Action.BROWSE)) {
                        desktop.browse(URI(entry.marketplaceUrl))
                    }
                }
                1 -> {
                    // Suppress for 24 hours
                    val until = System.currentTimeMillis() + 24 * 60 * 60 * 1000
                    PropertiesComponent.getInstance().setValue(NUDGE_SUPPRESS_KEY, until, 0L)
                }
            }
        }
    }

    private fun compareVersions(a: String, b: String): Int {
        val partsA = a.split(".").map { it.toIntOrNull() ?: 0 }
        val partsB = b.split(".").map { it.toIntOrNull() ?: 0 }

        for (i in 0 until 3) {
            val na = partsA.getOrElse(i) { 0 }
            val nb = partsB.getOrElse(i) { 0 }
            if (na < nb) return -1
            if (na > nb) return 1
        }
        return 0
    }

    override fun disposeComponent() {
        scheduler.shutdown()
    }
}

/**
 * Action: Hermes: Check for Updates — triggers an immediate version check.
 */
class CheckVersionAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val checker = ApplicationManager.getApplication()
            .getComponent(VersionChecker::class.java)
        checker.checkNow()
        Messages.showInfoMessage(e.project, "Version check completed.", "Hermes")
    }
}
