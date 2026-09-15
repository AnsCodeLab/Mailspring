import { compareVersions } from '../src/browser/version-compare';

describe('compareVersions', function () {
  it('returns 0 for identical versions', () => {
    expect(compareVersions('1.24.0.20260904', '1.24.0.20260904')).toEqual(0);
  });

  it('compares numerically, not lexicographically, within a segment', () => {
    // A naive string/lexicographic compare gets this exact case wrong:
    // '1.9' > '1.10' lexicographically, but 1.9 < 1.10 numerically.
    expect(compareVersions('1.9.0.20260101', '1.10.0.20260101')).toEqual(-1);
    expect(compareVersions('1.10.0.20260101', '1.9.0.20260101')).toEqual(1);
  });

  it('compares the date-like fourth segment numerically as well', () => {
    expect(compareVersions('1.24.0.20260904', '1.24.0.20260801')).toEqual(1);
    expect(compareVersions('1.24.0.20260801', '1.24.0.20260904')).toEqual(-1);
  });

  it('treats a missing trailing segment as 0', () => {
    expect(compareVersions('1.24.0', '1.24.0.0')).toEqual(0);
    expect(compareVersions('1.24.1', '1.24.0.99999999')).toEqual(1);
  });

  it('defaults a non-numeric segment to 0 instead of throwing', () => {
    expect(() => compareVersions('1.24.x.20260904', '1.24.0.20260904')).not.toThrow();
    // The garbage 3rd segment defaults both sides to 0 (a tie there); the
    // numeric 4th segment still decides the comparison correctly.
    expect(compareVersions('1.24.x.5', '1.24.0.3')).toEqual(1);
    expect(compareVersions('abc', '0.0.0.0')).toEqual(0);
  });

  it('compares major/minor/patch precedence correctly', () => {
    expect(compareVersions('2.0.0.20260101', '1.99.99.20261231')).toEqual(1);
    expect(compareVersions('1.24.1.20260101', '1.24.0.20261231')).toEqual(1);
  });
});
