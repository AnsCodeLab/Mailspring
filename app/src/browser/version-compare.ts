/**
 * Pure, numeric-safe comparison for this repo's `MAJOR.MINOR.PATCH.YYYYMMDD`
 * version scheme (e.g. `1.24.0.20260904`). A naive string/lexicographic
 * compare gets this scheme wrong (`'1.9' > '1.10'` lexicographically, but
 * `1.9 < 1.10` numerically) — this splits on `.` and compares each segment
 * as a parsed integer instead.
 *
 * A missing trailing segment (e.g. comparing `'1.24.0'` against
 * `'1.24.0.0'`) and a non-numeric segment (garbage/malformed input) both
 * default to `0` rather than throwing, so a malformed tag name never crashes
 * the update-check cycle.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const segmentsA = a.split('.');
  const segmentsB = b.split('.');
  const length = Math.max(segmentsA.length, segmentsB.length);

  for (let i = 0; i < length; i++) {
    const numA = parseSegment(segmentsA[i]);
    const numB = parseSegment(segmentsB[i]);
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

function parseSegment(segment: string | undefined): number {
  if (segment === undefined) return 0;
  const parsed = Number.parseInt(segment, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
