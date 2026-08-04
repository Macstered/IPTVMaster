import { describe, expect, it } from 'vitest';

import type { PlaylistInspection } from './source-import.js';
import {
  SnapshotRejectedError,
  validateSnapshotCandidate,
} from './snapshot-validation.js';

function inspection(liveCount: number, issueCount = 0): PlaylistInspection {
  return {
    fingerprint: 'd'.repeat(64),
    totalBytes: 100,
    entries: Array.from({ length: liveCount }, (_, index) => ({
      duration: -1,
      attributes: {},
      name: `Channel ${index}`,
      url: `http://provider.test/synthetic/${index}`,
      mediaType: 'live' as const,
      lineNumber: index * 2 + 2,
    })),
    issues: Array.from({ length: issueCount }, (_, index) => ({
      lineNumber: index + 1,
      code: 'invalid-extinf' as const,
      message: 'Synthetic parse issue',
    })),
    mediaCounts: { live: liveCount, vod: 0, series: 0, unknown: 0 },
    skippedEntries: 0,
  };
}

describe('last-known-good snapshot validation', () => {
  it('accepts a normal change in live channel count', () => {
    expect(() =>
      validateSnapshotCandidate(inspection(900), 1_000),
    ).not.toThrow();
  });

  it('rejects a suspicious drop relative to the last-known-good snapshot', () => {
    expect(() => validateSnapshotCandidate(inspection(400), 1_000)).toThrow(
      SnapshotRejectedError,
    );
  });

  it('rejects a snapshot dominated by parse issues', () => {
    expect(() =>
      validateSnapshotCandidate(inspection(100, 101), undefined),
    ).toThrow(/parse issues/);
  });
});
