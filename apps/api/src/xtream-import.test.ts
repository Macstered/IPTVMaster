import { mediaCategoryKey, ProviderHttpError } from '@iptvmaster/core';
import { describe, expect, it, vi } from 'vitest';

import { inspectRemoteXtreamPlaylist } from './xtream-import.js';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('native Xtream playlist import', () => {
  it('imports native categories and parent series without calling get.php', async () => {
    const actions: string[] = [];
    const payloads: Record<string, unknown> = {
      get_live_categories: [
        { category_id: '1', category_name: 'Live: Finland' },
      ],
      get_live_streams: [
        {
          stream_id: '101',
          name: 'Example TV',
          category_id: '1',
          epg_channel_id: 'example.fi',
          stream_icon: 'https://images.test/tv.png',
        },
      ],
      get_vod_categories: [
        { category_id: '20', category_name: 'Movies: Nordic' },
      ],
      get_vod_streams: [
        {
          stream_id: '201',
          name: 'Example Film',
          category_id: '20',
          container_extension: 'mkv',
        },
      ],
      get_series_categories: [
        { category_id: '1052', category_name: 'Series: Nordic 4K' },
      ],
      get_series: [
        {
          series_id: '11903',
          name: 'Avatar: The Last Airbender (2024)',
          category_id: '1052',
          cover: 'https://images.test/avatar.jpg',
        },
        {
          series_id: '11904',
          name: 'Spider-Noir (2026)',
          category_id: '1052',
        },
      ],
    };
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/player_api.php');
      expect(url.searchParams.get('username')).toBe('test-user');
      expect(url.searchParams.get('password')).toBe('test-password');
      const action = url.searchParams.get('action') ?? '';
      actions.push(action);
      return jsonResponse(payloads[action] ?? []);
    });

    const inspection = await inspectRemoteXtreamPlaylist(
      'http://provider.test/get.php?username=test-user&password=test-password',
      {
        fetchImplementation,
        selectiveGroups: new Set([
          mediaCategoryKey('vod', 'Movies: Nordic'),
          mediaCategoryKey('series', 'Series: Nordic 4K'),
        ]),
      },
    );

    expect(actions).toEqual([
      'get_live_categories',
      'get_live_streams',
      'get_vod_categories',
      'get_vod_streams',
      'get_series_categories',
      'get_series',
    ]);
    expect(inspection.mediaCounts).toEqual({
      live: 1,
      vod: 1,
      series: 2,
      unknown: 0,
    });
    expect(inspection.entries).toHaveLength(4);
    expect(
      inspection.entries
        .filter((entry) => entry.mediaType === 'series')
        .map((entry) => entry.name),
    ).toEqual(['Avatar: The Last Airbender (2024)', 'Spider-Noir (2026)']);
    expect(
      inspection.entries.some((entry) => /S\d{2}\s*E\d{2}/i.test(entry.name)),
    ).toBe(false);
    expect(
      new URL(
        inspection.entries.find(
          (entry) => entry.name === 'Avatar: The Last Airbender (2024)',
        )?.url ?? '',
      ).pathname,
    ).toBe('/series/test-user/test-password/11903.ts');
    expect(inspection.categories).toEqual([
      {
        mediaType: 'series',
        providerGroup: 'Series: Nordic 4K',
        itemCount: 2,
      },
      {
        mediaType: 'vod',
        providerGroup: 'Movies: Nordic',
        itemCount: 1,
      },
    ]);
  });

  it('indexes catalogue categories without retaining unselected titles', async () => {
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const action = new URL(String(input)).searchParams.get('action');
      if (action === 'get_vod_categories') {
        return jsonResponse([{ category_id: '20', category_name: 'Movies' }]);
      }
      if (action === 'get_vod_streams') {
        return jsonResponse([
          { stream_id: '201', name: 'Film', category_id: '20' },
        ]);
      }
      if (action === 'get_series_categories') {
        return jsonResponse([{ category_id: '30', category_name: 'Series' }]);
      }
      if (action === 'get_series') {
        return jsonResponse([
          { series_id: '301', name: 'Show', category_id: '30' },
        ]);
      }
      throw new Error('Unexpected native Xtream action');
    });

    const inspection = await inspectRemoteXtreamPlaylist(
      'http://provider.test/get.php?username=test-user&password=test-password',
      { fetchImplementation, includeLive: false },
    );

    expect(inspection.entries).toEqual([]);
    expect(inspection.skippedEntries).toBe(2);
    expect(inspection.categories).toHaveLength(2);
  });

  it('treats a section the account cannot use as empty rather than fatal', async () => {
    // Panels answer `false`, not `[]`, for an action that is off for the
    // account. Live and films still import; only series are absent.
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => {
      const action = new URL(String(input)).searchParams.get('action');
      if (action === 'get_live_categories') {
        return jsonResponse([{ category_id: '1', category_name: 'Live' }]);
      }
      if (action === 'get_live_streams') {
        return jsonResponse([
          { stream_id: '101', name: 'Example TV', category_id: '1' },
        ]);
      }
      if (action === 'get_vod_categories') {
        return jsonResponse([{ category_id: '20', category_name: 'Movies' }]);
      }
      if (action === 'get_vod_streams') {
        return jsonResponse([
          { stream_id: '201', name: 'Film', category_id: '20' },
        ]);
      }
      return jsonResponse(false);
    });

    const inspection = await inspectRemoteXtreamPlaylist(
      'http://provider.test/get.php?username=test-user&password=test-password',
      { fetchImplementation },
    );

    expect(inspection.mediaCounts).toEqual({
      live: 1,
      vod: 1,
      series: 0,
      unknown: 0,
    });
    expect(inspection.categories).toEqual([
      { mediaType: 'vod', providerGroup: 'Movies', itemCount: 1 },
    ]);
  });

  it('still rejects a section that is neither absent nor a list', async () => {
    await expect(
      inspectRemoteXtreamPlaylist(
        'http://provider.test/get.php?username=test-user&password=test-password',
        {
          fetchImplementation: async () =>
            jsonResponse({ user_info: { status: 'Active' } }),
        },
      ),
    ).rejects.toThrow(/malformed/);
  });

  it('keeps provider HTTP failures classified for a safe gateway response', async () => {
    await expect(
      inspectRemoteXtreamPlaylist(
        'http://provider.test/get.php?username=test-user&password=test-password',
        {
          fetchImplementation: async () =>
            new Response('rejected', { status: 511 }),
        },
      ),
    ).rejects.toBeInstanceOf(ProviderHttpError);
  });
});
