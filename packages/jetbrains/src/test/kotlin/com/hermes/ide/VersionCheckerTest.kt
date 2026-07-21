package com.hermes.ide

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

/**
 * Unit tests for version management.
 */
class VersionCheckerTest {

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

    @Test
    fun `equal versions compare to zero`() {
        assertEquals(0, compareVersions("1.0.0", "1.0.0"))
        assertEquals(0, compareVersions("0.1.0", "0.1.0"))
        assertEquals(0, compareVersions("2.3.4", "2.3.4"))
    }

    @Test
    fun `older version is less than newer`() {
        assertTrue(compareVersions("0.1.0", "1.0.0") < 0)
        assertTrue(compareVersions("1.0.0", "1.1.0") < 0)
        assertTrue(compareVersions("1.1.0", "1.1.1") < 0)
        assertTrue(compareVersions("0.0.1", "0.0.2") < 0)
    }

    @Test
    fun `newer version is greater than older`() {
        assertTrue(compareVersions("1.0.0", "0.1.0") > 0)
        assertTrue(compareVersions("1.2.0", "1.1.0") > 0)
        assertTrue(compareVersions("2.0.0", "1.9.9") > 0)
    }

    @Test
    fun `major version dominates`() {
        assertTrue(compareVersions("2.0.0", "1.999.999") > 0)
        assertTrue(compareVersions("0.9.9", "1.0.0") < 0)
    }

    @Test
    fun `handles missing version parts`() {
        // "0.1" should be treated as "0.1.0"
        assertEquals(0, compareVersions("0.1", "0.1.0"))
    }

    @Test
    fun `minVersion check blocks older`() {
        val installed = "0.1.0"
        val minVersion = "1.0.0"
        assertTrue(compareVersions(installed, minVersion) < 0)
    }

    @Test
    fun `recommended update detected when below recommended`() {
        val installed = "1.0.0"
        val recommended = "1.2.0"
        assertTrue(compareVersions(installed, recommended) < 0)
    }
}
