package com.hermes.ide.auth

import com.google.gson.Gson
import com.hermes.ide.DeviceCodeResponse
import com.hermes.ide.TokenResponse
import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * Manages OAuth device flow for the Hermes IDE Coding Agent (JetBrains).
 *
 * Flow:
 * 1. POST /oauth/device → get user_code + verification_uri
 * 2. Open browser to verification_uri_complete
 * 3. Poll POST /oauth/token until success or timeout
 * 4. Store JWT in PasswordSafe (JetBrains' equivalent of VS Code SecretStorage)
 */
class OAuthDeviceFlow {
    private val gson = Gson()
    private val httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build()

    private val credentialAttributes = CredentialAttributes(
        "hermes.authToken",
        null,
        HermesCredentialAttributes::class.java,
        false,
    )

    companion object {
        private const val POLL_INTERVAL_MS = 5_000L
        private const val MAX_POLL_ATTEMPTS = 120 // 10 minutes at 5s intervals
        private const val WORKSPACE_KEY = "hermes.selectedWorkspaceId"

        @Volatile
        private var instance: OAuthDeviceFlow? = null

        fun getInstance(): OAuthDeviceFlow {
            return instance ?: synchronized(this) {
                instance ?: OAuthDeviceFlow().also { instance = it }
            }
        }
    }

    /**
     * Returns the stored JWT token, or null if not authenticated.
     */
    fun getToken(): String? {
        val credentials = PasswordSafe.instance.get(credentialAttributes)
        return credentials?.getPasswordAsString()
    }

    /**
     * Returns the currently selected workspace ID.
     */
    fun getWorkspaceId(): String? {
        return PropertiesComponent.getInstance().getValue(WORKSPACE_KEY)
    }

    /**
     * Auto-connect on startup — restore stored token.
     * Returns true if a valid token was found.
     */
    fun autoConnect(): Boolean {
        return getToken() != null
    }

    /**
     * Initiate the OAuth device flow:
     * 1. Request device code from user-service
     * 2. Open browser for user to authorize
     * 3. Begin polling for token
     */
    fun startDeviceFlow(userServiceUrl: String, clientId: String) {
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                // Step 1: Request device code
                val deviceRequest = HttpRequest.newBuilder()
                    .uri(URI.create("$userServiceUrl/oauth/device"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(
                        """{"client_id":"$clientId"}"""))
                    .build()

                val deviceResp = httpClient.send(deviceRequest, HttpResponse.BodyHandlers.ofString())
                if (deviceResp.statusCode() != 200) {
                    throw RuntimeException("Device code request failed: ${deviceResp.statusCode()}")
                }

                val deviceData = gson.fromJson(deviceResp.body(), DeviceCodeResponse::class.java)

                // Step 2: Open browser
                val desktop = java.awt.Desktop.getDesktop()
                if (desktop.isSupported(java.awt.Desktop.Action.BROWSE)) {
                    desktop.browse(URI(deviceData.verificationUriComplete))
                }

                // Step 3: Begin polling
                pollForToken(userServiceUrl, clientId, deviceData.deviceCode)
            } catch (e: Exception) {
                // Error handled by caller via Messages.showErrorDialog
                throw RuntimeException("OAuth device flow failed: ${e.message}", e)
            }
        }
    }

    /**
     * Poll the token endpoint until the user authorizes or the device code expires.
     */
    private fun pollForToken(userServiceUrl: String, clientId: String, deviceCode: String) {
        var attempts = 0

        while (attempts < MAX_POLL_ATTEMPTS) {
            attempts++
            Thread.sleep(POLL_INTERVAL_MS)

            try {
                val tokenRequest = HttpRequest.newBuilder()
                    .uri(URI.create("$userServiceUrl/oauth/token"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("""{
                        "client_id": "$clientId",
                        "device_code": "$deviceCode",
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
                    }""".replace("\n", "")))
                    .build()

                val tokenResp = httpClient.send(tokenRequest, HttpResponse.BodyHandlers.ofString())

                when {
                    tokenResp.statusCode() == 400 -> {
                        // Still waiting for user — authorization_pending or slow_down
                        continue
                    }
                    tokenResp.statusCode() != 200 -> {
                        throw RuntimeException("Token request failed (${tokenResp.statusCode()})")
                    }
                    else -> {
                        val tokenData = gson.fromJson(tokenResp.body(), TokenResponse::class.java)
                        storeToken(tokenData.accessToken)
                        return // Success
                    }
                }
            } catch (e: Exception) {
                if (e is InterruptedException) throw e
                throw RuntimeException("Token request error: ${e.message}", e)
            }
        }
        throw RuntimeException("Device code expired. Please try again.")
    }

    /**
     * Store the JWT in PasswordSafe.
     */
    private fun storeToken(token: String) {
        val credentials = Credentials(null, token)
        PasswordSafe.instance.set(credentialAttributes, credentials)
    }

    /**
     * Disconnect: clear the stored token.
     */
    fun disconnect() {
        PasswordSafe.instance.set(credentialAttributes, null)
        PropertiesComponent.getInstance().unsetValue(WORKSPACE_KEY)
    }

    /**
     * Set the selected workspace ID.
     */
    fun setWorkspaceId(workspaceId: String) {
        PropertiesComponent.getInstance().setValue(WORKSPACE_KEY, workspaceId)
    }
}

/**
 * Marker class for PasswordSafe credential namespace.
 */
private class HermesCredentialAttributes
