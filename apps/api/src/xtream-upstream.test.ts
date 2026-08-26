import { describe, expect, it, vi } from 'vitest';

import { fetchXtreamSeriesArtwork } from './xtream-upstream.js';

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
              name: 'Example Show',
              category_id: '7',
              cover: 'https://images.test/example-poster.jpg',
            },
            {
              name: 'Unsafe cover',
              category_id: '8',
              cover: 'file:///etc/passwd',
            },
            {
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
