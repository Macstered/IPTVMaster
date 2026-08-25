import { describe, expect, it } from 'vitest';

import { parseM3uText } from './m3u.js';
import { mediaCategoryKey } from './types.js';

const playlist = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="FI| SUOMI",Yle TV1',
  'http://provider.test/live/u/p/1.ts',
  '#EXTINF:-1 group-title="Action",Die Hard',
  'http://provider.test/movie/u/p/10.mkv',
  '#EXTINF:-1 group-title="Action",Speed',
  'http://provider.test/movie/u/p/11.mkv',
  '#EXTINF:-1 group-title="Drama",Nomadland',
  'http://provider.test/movie/u/p/12.mkv',
  '#EXTINF:-1 group-title="Nordic Crime",Bron S01E01',
  'http://provider.test/series/u/p/20.mkv',
].join('\n');

describe('catalogue categories', () => {
  it('counts every category even when nothing is retained', async () => {
    const result = await parseM3uText(playlist, {
      includeMediaTypes: ['live'],
    });

    expect(result.entries.map((entry) => entry.name)).toEqual(['Yle TV1']);
    expect(result.categories).toEqual([
      { mediaType: 'series', providerGroup: 'Nordic Crime', itemCount: 1 },
      { mediaType: 'vod', providerGroup: 'Action', itemCount: 2 },
      { mediaType: 'vod', providerGroup: 'Drama', itemCount: 1 },
    ]);
    // The catalogue is browsable without any of it being stored.
    expect(result.skippedEntries).toBe(4);
  });

  it('retains only the categories that were chosen', async () => {
    const result = await parseM3uText(playlist, {
      includeMediaTypes: ['live'],
      selectiveGroups: new Set([
        mediaCategoryKey('vod', 'Action'),
        mediaCategoryKey('series', 'Nordic Crime'),
      ]),
    });

    expect(result.entries.map((entry) => entry.name)).toEqual([
      'Yle TV1',
      'Die Hard',
      'Speed',
      'Bron S01E01',
    ]);
    expect(result.skippedEntries).toBe(1);
    // Counts still describe the whole catalogue, not just what was kept.
    expect(
      result.categories.find((c) => c.providerGroup === 'Drama')?.itemCount,
    ).toBe(1);
  });

  it('does not confuse a film category with a live group of the same name', async () => {
    const clashing = [
      '#EXTM3U',
      '#EXTINF:-1 group-title="Sport",Sky Sports',
      'http://provider.test/live/u/p/2.ts',
      '#EXTINF:-1 group-title="Sport",Rocky',
      'http://provider.test/movie/u/p/13.mkv',
    ].join('\n');

    const result = await parseM3uText(clashing, {
      includeMediaTypes: ['live'],
      selectiveGroups: new Set([mediaCategoryKey('series', 'Sport')]),
    });

    // The chosen key names a series category, so the film stays out.
    expect(result.entries.map((entry) => entry.name)).toEqual(['Sky Sports']);
    expect(result.categories).toEqual([
      { mediaType: 'vod', providerGroup: 'Sport', itemCount: 1 },
    ]);
  });

  it('groups uncategorised titles under an empty name rather than dropping them', async () => {
    const result = await parseM3uText(
      [
        '#EXTM3U',
        '#EXTINF:-1,Loose Film',
        'http://provider.test/movie/1.mkv',
      ].join('\n'),
      { includeMediaTypes: ['live'] },
    );

    expect(result.categories).toEqual([
      { mediaType: 'vod', providerGroup: '', itemCount: 1 },
    ]);
  });
});
