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
    categories: [],
  };
}

/** A snapshot carrying channels plus whatever catalogue titles are enabled. */
function withCatalogue(
  liveCount: number,
  titleCount: number,
): PlaylistInspection {
  const base = inspection(liveCount);
  return {
    ...base,
    entries: [
      ...base.entries,
      ...Array.from({ length: titleCount }, (_, index) => ({
        duration: -1,
        attributes: {},
        name: `Film ${index}`,
        url: `http://provider.test/movie/${index}.mkv`,
        mediaType: 'vod' as const,
        lineNumber: 10_000 + index,
      })),
    ],
  };
}

describe('catalogue titles and the live count', () => {
  it('does not let enabled films inflate the live count', () => {
    // 400 channels against a previous 1,000 is a suspicious drop even when
    // thousands of films make the snapshot look larger than before.
    expect(() =>
      validateSnapshotCandidate(withCatalogue(400, 5_000), 1_000),
    ).toThrow(SnapshotRejectedError);
  });

  it('still accepts a healthy lineup carrying a catalogue', () => {
    expect(() =>
      validateSnapshotCandidate(withCatalogue(900, 5_000), 1_000),
    ).not.toThrow();
  });

  it('allows a channel-free snapshot when live import is off', () => {
    expect(() =>
      validateSnapshotCandidate(withCatalogue(0, 20), undefined, {
        minimumLiveEntries: 0,
      }),
    ).not.toThrow();
  });

  it('rejects a snapshot that would publish nothing at all', () => {
    expect(() =>
      validateSnapshotCandidate(withCatalogue(0, 0), undefined, {
        minimumLiveEntries: 0,
      }),
    ).toThrow(/empty/i);
  });
});

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
