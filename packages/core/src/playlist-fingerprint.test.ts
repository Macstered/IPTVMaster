import { describe, expect, it } from 'vitest';
import { retainedPlaylistFingerprint } from './playlist-fingerprint.js';
import { inspectRemotePlaylist } from './source-import.js';
import { mediaCategoryKey, type M3uEntry } from './types.js';

const entry: M3uEntry = {
  name: 'Example TV',
  url: 'https://fixture.test/live/demo/demo/1.ts',
  mediaType: 'live',
  duration: -1,
  lineNumber: 2,
  attributes: { 'tvg-id': 'example', 'group-title': 'TV' },
};

describe('retained playlist identity', () => {
  it('ignores line offsets and attribute key order but preserves meaningful edits', () => {
    const hash = retainedPlaylistFingerprint([entry]);
    expect(
      retainedPlaylistFingerprint([
        {
          ...entry,
          lineNumber: 100,
          attributes: { 'group-title': 'TV', 'tvg-id': 'example' },
        },
      ]),
    ).toBe(hash);
    for (const changed of [
      { ...entry, name: 'Renamed' },
      { ...entry, url: 'https://fixture.test/live/demo/demo/2.ts' },
      { ...entry, duration: 5 },
      {
        ...entry,
        attributes: {
          ...entry.attributes,
          'tvg-logo': 'https://fixture.test/logo.png',
        },
      },
      {
        ...entry,
        attributes: { ...entry.attributes, 'group-title': 'New group' },
      },
    ])
      expect(retainedPlaylistFingerprint([changed])).not.toBe(hash);
    const second = { ...entry, name: 'Second' };
    expect(retainedPlaylistFingerprint([entry, second])).not.toBe(
      retainedPlaylistFingerprint([second, entry]),
    );
  });

  it('does not rewrite live selections when skipped M3U movies change', async () => {
    const inspect = (movie: string, selected = false) =>
      inspectRemotePlaylist('https://fixture.test/list', {
        fetchImplementation: async () =>
          new Response(
            [
              '#EXTM3U',
              '#EXTINF:-1 group-title="Movies",' + movie,
              'https://fixture.test/movie/demo/demo/5.mp4',
              '#EXTINF:-1 group-title="TV",Example TV',
              entry.url,
            ].join('\n'),
          ),
        selectiveGroups: new Set(
          selected ? [mediaCategoryKey('vod', 'Movies')] : [],
        ),
      });
    const first = await inspect('Before');
    const second = await inspect('After');
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.categories).toEqual(first.categories);
    // Same upstream body, a different retained selection must not hit the old snapshot.
    expect((await inspect('After', true)).fingerprint).not.toBe(
      second.fingerprint,
    );
  });
});
