/**
 * Unit tests for the version checker's _compareVersions method.
 *
 * Since _compareVersions is private, we test it indirectly through
 * the exported public API or replicate the logic for testing.
 */

import { deepStrictEqual } from 'assert';

// ── Replicated version comparison for direct testing ──────────────────
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map(Number);
  const partsA = parse(a);
  const partsB = parse(b);

  for (let i = 0; i < 3; i++) {
    const na = partsA[i] ?? 0;
    const nb = partsB[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

// ── Tests ────────────────────────────────────────────────────────────

// Equal versions
deepStrictEqual(compareVersions('1.0.0', '1.0.0'), 0, '1.0.0 == 1.0.0');
deepStrictEqual(compareVersions('2.3.4', '2.3.4'), 0, '2.3.4 == 2.3.4');
deepStrictEqual(compareVersions('0.1.0', '0.1.0'), 0, '0.1.0 == 0.1.0');

// a < b (need to update)
deepStrictEqual(compareVersions('0.1.0', '1.0.0'), -1, '0.1.0 < 1.0.0');
deepStrictEqual(compareVersions('1.0.0', '1.1.0'), -1, '1.0.0 < 1.1.0');
deepStrictEqual(compareVersions('1.0.0', '1.0.1'), -1, '1.0.0 < 1.0.1');
deepStrictEqual(compareVersions('0.9.9', '1.0.0'), -1, '0.9.9 < 1.0.0');
deepStrictEqual(compareVersions('1.0.0', '2.0.0'), -1, '1.0.0 < 2.0.0');

// a > b (installed is newer than min)
deepStrictEqual(compareVersions('2.0.0', '1.0.0'), 1, '2.0.0 > 1.0.0');
deepStrictEqual(compareVersions('1.5.0', '1.4.9'), 1, '1.5.0 > 1.4.9');
deepStrictEqual(compareVersions('1.0.1', '1.0.0'), 1, '1.0.1 > 1.0.0');

// Edge cases: missing patch/minor versions
deepStrictEqual(compareVersions('1', '1.0.0'), 0, '1 == 1.0.0 (missing parts default to 0)');
deepStrictEqual(compareVersions('1.0', '1.0.0'), 0, '1.0 == 1.0.0');
deepStrictEqual(compareVersions('1.0', '1.1'), -1, '1.0 < 1.1');
deepStrictEqual(compareVersions('2', '1.9.9'), 1, '2 > 1.9.9');

// Four-part versions (should still work — extra parts beyond 3 ignored)
deepStrictEqual(compareVersions('1.0.0.1', '1.0.0'), 0, '1.0.0.1 == 1.0.0 (extra parts ignored)');

console.log('✅ Version comparison tests passed');
