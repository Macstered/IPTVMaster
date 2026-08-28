import { describe, expect, it, vi } from 'vitest';

import {
  fetchXtreamSeriesArtwork,
  fetchXtreamSeriesCatalogue,
  fetchXtreamSeriesInfo,
} from './xtream-upstream.js';

function jsonResponse(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('Xtream upstream series artwork', () => {
  it('loads validated covers and resolves category names', async () => {
    const actions: string[] = [];
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const action = url.searchParams.get('action') ?? '';
      actions.push(action);
      expect(url.searchParams.get('username')).toBe('provider-user');
      expect(url.searchParams.get('password')).toBe('provider-password');
      return action === 'get_series_categories'
        ? jsonResponse([
            { category_id: '7', category_name: 'Drama' },
            { category_id: '8', category_name: 'Comedy' },
          ])
        : jsonResponse([
            {
              series_id: '11903',
              name: 'Example Show',
              category_id: '7',
              cover: 'https://images.test/example-poster.jpg',
            },
            {
              series_id: '11904',
              name: 'Unsafe cover',
              category_id: '8',
              cover: 'file:///etc/passwd',
            },
            {
              series_id: '11905',
              name: 'Unknown category',
              category_id: '99',
              cover: 'https://images.test/unknown.jpg',
            },
          ]);
    });

    const artwork = await fetchXtreamSeriesArtwork(
      'http://provider.test/get.php?username=provider-user&password=provider-password',
      { fetchImplementation },
    );

    expect(actions.sort()).toEqual(['get_series', 'get_series_categories']);
    expect(artwork).toEqual([
      {
        name: 'Example Show',
        categoryName: 'Drama',
        cover: 'https://images.test/example-poster.jpg',
      },
    ]);
  });

  it('preserves provider category and parent-series identifiers', async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const action = new URL(String(input)).searchParams.get('action');
      if (action === 'get_series_categories') {
        return jsonResponse([
          {
            category_id: '1052',
            category_name: 'Series: Nordic 4K',
            parent_id: 0,
          },
        ]);
      }
      return jsonResponse([
        {
          series_id: '11903',
          name: '4K - NC Avatar: The Last Airbender (2024)',
          category_id: '1052',
          cover: 'https://images.test/avatar.jpg',
          rating_5based: 4.5,
        },
      ]);
    });

    const catalogue = await fetchXtreamSeriesCatalogue(
      'http://provider.test/get.php?username=provider-user&password=provider-password',
      { fetchImplementation },
    );

    expect(catalogue.categories).toEqual([
      {
        categoryId: '1052',
        categoryName: 'Series: Nordic 4K',
        parentId: 0,
      },
    ]);
    expect(catalogue.series).toEqual([
      expect.objectContaining({
        seriesId: 11903,
        categoryId: '1052',
        name: '4K - NC Avatar: The Last Airbender (2024)',
      }),
    ]);
  });

  it('preserves multi-season provider episode hierarchy', async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('action')).toBe('get_series_info');
      expect(url.searchParams.get('series_id')).toBe('11903');
      return jsonResponse({
        seasons: [
          { season_number: 1, episode_count: 2, name: 'Season 1' },
          { season_number: 2, episode_count: 1, name: 'Season 2' },
        ],
        episodes: {
          '1': [
            {
              id: '101',
              episode_num: 1,
              title: 'Avatar S01E01',
              season: 1,
              container_extension: 'mkv',
              info: { movie_image: 'https://images.test/s01e01.jpg' },
            },
            {
              id: '102',
              episode_num: 2,
              title: 'Avatar S01 E02',
              season: 1,
              container_extension: 'mkv',
            },
          ],
          '2': [
            {
              id: '201',
              episode_num: 1,
              title: 'Avatar S02E01',
              season: 2,
              container_extension: 'mp4',
            },
          ],
        },
      });
    });

    const detail = await fetchXtreamSeriesInfo(
      'http://provider.test/get.php?username=provider-user&password=provider-password',
      11903,
      { fetchImplementation },
    );

    expect(detail.seasons).toHaveLength(2);
    expect(detail.episodes['1']?.map((episode) => episode.id)).toEqual([
      '101',
      '102',
    ]);
    expect(detail.episodes['2']?.[0]).toEqual(
      expect.objectContaining({ id: '201', season: 2 }),
    );
  });

  it('rejects oversized chunked metadata responses', async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse([{ category_id: '7', category_name: 'Drama' }]),
    );
    fetchImplementation.mockResolvedValueOnce(
      jsonResponse([{ category_id: '7', category_name: 'Drama' }]),
    );
    fetchImplementation.mockResolvedValueOnce(
      jsonResponse([
        {
          series_id: '11903',
          name: 'Example Show',
          category_id: '7',
          cover: 'https://images.test/example.jpg',
        },
      ]),
    );

    await expect(
      fetchXtreamSeriesArtwork(
        'http://provider.test/get.php?username=provider-user&password=provider-password',
        { fetchImplementation, maxResponseBytes: 20 },
      ),
    ).rejects.toThrow('too large');
  });

  it('requires a complete Xtream-shaped playlist URL', async () => {
    await expect(
      fetchXtreamSeriesArtwork('http://provider.test/list.m3u'),
    ).rejects.toThrow('does not contain an Xtream login');
  });
});
