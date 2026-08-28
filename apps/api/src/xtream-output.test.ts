import { describe, expect, it } from 'vitest';

import type { M3uEntry } from '@iptvmaster/core';

import {
  buildHybridXtreamSeriesCatalogue,
  buildXtreamFlatCatalogue,
  buildXtreamSeriesCatalogue,
  buildXtreamSeriesDetailFromUpstream,
  decodeXtreamStreamId,
  parseSeriesEpisode,
  type XtreamOutputEntry,
  xtreamStreamId,
} from './xtream-output.js';

function item(
  name: string,
  url: string,
  mediaType: M3uEntry['mediaType'],
  group: string,
  sourceIndex = 0,
): XtreamOutputEntry {
  return {
    sourceId: `source-${sourceIndex}`,
    sourceIndex,
    entry: {
      duration: -1,
      attributes: {
        'group-title': group,
        'tvg-logo': 'http://logos.test/poster.jpg',
      },
      name,
      url,
      mediaType,
      lineNumber: 1,
    },
  };
}

describe('Xtream-compatible output', () => {
  it('builds categories and numeric stream identifiers', () => {
    const first = item(
      'First film',
      'http://provider.test/movie/user/pass/42.mkv',
      'vod',
      'Films',
    );
    const second = item(
      'Second film',
      'http://provider.test/movie/user/pass/42.mp4',
      'vod',
      'Nordic',
      1,
    );
    const catalogue = buildXtreamFlatCatalogue([first, second], 'vod');

    expect(catalogue.categories).toHaveLength(2);
    expect(catalogue.streams).toEqual([
      expect.objectContaining({
        name: 'First film',
        stream_id: 42,
        container_extension: 'mkv',
      }),
      expect.objectContaining({
        name: 'Second film',
        stream_id: 100_000_042,
        container_extension: 'mp4',
      }),
    ]);
    expect(decodeXtreamStreamId('100000042', 2)).toEqual({
      sourceIndex: 1,
      providerStreamId: '42',
    });
    expect(xtreamStreamId(first)).toBe(42);
  });

  it('deduplicates identical movie streams while preserving their categories', () => {
    const duplicateUrl = 'http://provider.test/movie/user/pass/42.mkv';
    const catalogue = buildXtreamFlatCatalogue(
      [
        item('First film', duplicateUrl, 'vod', 'Films'),
        item('First film', duplicateUrl, 'vod', 'Nordic'),
      ],
      'vod',
    );

    expect(catalogue.categories).toHaveLength(2);
    expect(catalogue.streams).toHaveLength(1);
    expect(catalogue.streams[0]?.category_ids).toHaveLength(2);
  });

  it('uses provider series posters without replacing episode stills', () => {
    const episode = item(
      'Example Show 2024 - S01E01 - Pilot',
      'http://provider.test/series/user/pass/101.mkv',
      'series',
      'Drama',
    );
    episode.entry.attributes['tvg-logo'] =
      'http://logos.test/episode-screenshot.jpg';
    const catalogue = buildXtreamSeriesCatalogue(
      [episode],
      new Map([
        [
          'source-0',
          [
            {
              name: 'Example Show (2024)',
              categoryName: 'Drama',
              cover: 'https://images.test/example-poster.jpg',
            },
          ],
        ],
      ]),
    );
    const summary = catalogue.series[0];
    const detail = summary
      ? catalogue.detailsById.get(summary.series_id)
      : undefined;

    expect(summary?.cover).toBe('https://images.test/example-poster.jpg');
    expect(detail?.episodes['1']?.[0]?.info.movie_image).toBe(
      'http://logos.test/episode-screenshot.jpg',
    );
  });

  it('does not use an episode screenshot as an unmatched series poster', () => {
    const catalogue = buildXtreamSeriesCatalogue(
      [
        item(
          'Unmatched Show - S01E01',
          'http://provider.test/series/user/pass/101.mkv',
          'series',
          'Drama',
        ),
      ],
      new Map([
        [
          'source-0',
          [
            {
              name: 'Different Show',
              categoryName: 'Drama',
              cover: 'https://images.test/different-poster.jpg',
            },
          ],
        ],
      ]),
    );

    expect(catalogue.series[0]?.cover).toBe('');
  });

  it('collapses episode rows into series summaries and per-season details', () => {
    const entries = [
      item(
        'Example Show - S01E02 - Second',
        'http://provider.test/series/user/pass/102.mkv',
        'series',
        'Drama',
      ),
      item(
        'Example Show - S01E01 - Pilot',
        'http://provider.test/series/user/pass/101.mkv',
        'series',
        'Drama',
      ),
      item(
        'Example Show - S02E01',
        'http://provider.test/series/user/pass/201.mp4',
        'series',
        'Drama',
      ),
    ];
    const catalogue = buildXtreamSeriesCatalogue(entries);
    const summary = catalogue.series[0];
    const detail = summary
      ? catalogue.detailsById.get(summary.series_id)
      : undefined;

    expect(catalogue.categories).toHaveLength(1);
    expect(catalogue.series).toHaveLength(1);
    expect(summary).toEqual(expect.objectContaining({ name: 'Example Show' }));
    expect(
      detail?.episodes['1']?.map((episode) => episode.episode_num),
    ).toEqual([1, 2]);
    expect(detail?.episodes['2']?.[0]).toEqual(
      expect.objectContaining({
        id: '201',
        season: 2,
        container_extension: 'mp4',
      }),
    );
  });

  it('uses upstream parents instead of M3U episode rows', () => {
    const entries = [
      item(
        '4K - NC Avatar: The Last Airbender (2024) S01E01',
        'http://provider.test/series/user/pass/101.mkv',
        'series',
        'Series: Nordic 4K',
      ),
      item(
        '4K - NC Avatar: The Last Airbender (2024) S01 E02',
        'http://provider.test/series/user/pass/102.mkv',
        'series',
        'Series: Nordic 4K',
      ),
      item(
        '4K - NC Avatar: The Last Airbender (2024) S02E01',
        'http://provider.test/series/user/pass/201.mp4',
        'series',
        'Series: Nordic 4K',
      ),
    ];
    const catalogue = buildHybridXtreamSeriesCatalogue(
      entries,
      new Map([
        [
          'source-0',
          {
            categories: [
              {
                categoryId: '1052',
                categoryName: 'Series: Nordic 4K',
                parentId: 0,
              },
            ],
            series: [
              {
                seriesId: 11903,
                name: '4K - NC Avatar: The Last Airbender (2024)',
                categoryId: '1052',
                cover: 'https://images.test/avatar.jpg',
                plot: '',
                cast: '',
                director: '',
                genre: '',
                releaseDate: '',
                lastModified: '',
                rating: '',
                rating5Based: 0,
                backdropPath: [],
                youtubeTrailer: '',
                tmdb: '',
                episodeRunTime: '',
              },
            ],
          },
        ],
      ]),
    );

    expect(catalogue.categories).toEqual([
      expect.objectContaining({
        category_id: '1052',
        category_name: 'Series: Nordic 4K',
      }),
    ]);
    expect(catalogue.series).toEqual([
      expect.objectContaining({
        series_id: 11903,
        name: '4K - NC Avatar: The Last Airbender (2024)',
        category_id: '1052',
      }),
    ]);
    expect(
      catalogue.series.some((series) => /S\d{2}\s*E\d{2}/i.test(series.name)),
    ).toBe(false);
    expect(catalogue.upstreamById.get(11903)).toEqual(
      expect.objectContaining({ upstreamSeriesId: 11903 }),
    );
  });

  it('rewrites provider episodes into playable multi-season detail', () => {
    const summary = {
      num: 1,
      name: 'Avatar: The Last Airbender (2024)',
      series_id: 11903,
      cover: 'https://images.test/avatar.jpg',
      plot: '',
      cast: '',
      director: '',
      genre: '',
      releaseDate: '',
      release_date: '',
      last_modified: '',
      rating: '',
      rating_5based: 0,
      backdrop_path: [],
      youtube_trailer: '',
      tmdb: '',
      episode_run_time: '',
      category_id: '1052',
      category_ids: ['1052'],
    };
    const detail = buildXtreamSeriesDetailFromUpstream(
      {
        sourceId: 'source-0',
        sourceIndex: 0,
        upstreamSeriesId: 11903,
        summary,
      },
      {
        seasons: [
          { season_number: 1, episode_count: 2 },
          { season_number: 2, episode_count: 1 },
        ],
        episodes: {
          '1': [
            {
              id: '101',
              episodeNumber: 1,
              title: 'Avatar S01E01',
              containerExtension: 'mkv',
              added: '1',
              season: 1,
              info: {
                tmdbId: 0,
                releaseDate: '',
                plot: '',
                durationSeconds: 0,
                duration: '',
                movieImage: '',
                bitrate: 0,
                rating: 0,
              },
            },
            {
              id: '102',
              episodeNumber: 2,
              title: 'Avatar S01 E02',
              containerExtension: 'mkv',
              added: '2',
              season: 1,
              info: {
                tmdbId: 0,
                releaseDate: '',
                plot: '',
                durationSeconds: 0,
                duration: '',
                movieImage: '',
                bitrate: 0,
                rating: 0,
              },
            },
          ],
          '2': [
            {
              id: '201',
              episodeNumber: 1,
              title: 'Avatar S02E01',
              containerExtension: 'mp4',
              added: '3',
              season: 2,
              info: {
                tmdbId: 0,
                releaseDate: '',
                plot: '',
                durationSeconds: 0,
                duration: '',
                movieImage: '',
                bitrate: 0,
                rating: 0,
              },
            },
          ],
        },
      },
    );

    expect(detail.seasons).toHaveLength(2);
    expect(detail.episodes['1']?.map((episode) => episode.id)).toEqual([
      '101',
      '102',
    ]);
    expect(detail.episodes['2']?.[0]).toEqual(
      expect.objectContaining({
        id: '201',
        season: 2,
        container_extension: 'mp4',
        direct_source: '',
      }),
    );
  });
  it('recognizes common season and episode label formats', () => {
    expect(parseSeriesEpisode('Example - S03E12 - Finale')).toEqual({
      seriesName: 'Example',
      season: 3,
      episodeNumber: 12,
      episodeTitle: 'Finale',
    });
    expect(parseSeriesEpisode('Example - S03 E12 - Finale')).toEqual({
      seriesName: 'Example',
      season: 3,
      episodeNumber: 12,
      episodeTitle: 'Finale',
    });
    expect(parseSeriesEpisode('Example 2x04')).toEqual(
      expect.objectContaining({ season: 2, episodeNumber: 4 }),
    );
  });
});
