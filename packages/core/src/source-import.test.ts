import { describe, expect, it } from 'vitest';

import { ProviderHttpError } from './provider-error.js';
import { PlaylistEntryLimitError } from './m3u.js';
import {
  DEFAULT_MAX_RETAINED_ENTRIES,
  inspectRemotePlaylist,
} from './source-import.js';

function responseFor(
  body: string,
  contentType = 'audio/x-mpegurl',
): typeof fetch {
  return async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': contentType },
    });
}

describe('remote playlist inspection', () => {
  const mixedPlaylist = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="Finland",Yle TV1',
    'http://provider.test/user/pass/1',
    '#EXTINF:-1 group-title="Movies",Example movie',
    'http://provider.test/movie/user/pass/2.mkv',
    '#EXTINF:-1 group-title="Events",17:00 Example event 8/4',
    'http://provider.test/user/pass/3',
    '',
  ].join('\n');

  it('retains only live entries while counting skipped VOD', async () => {
    const result = await inspectRemotePlaylist('http://provider.test/get.php', {
      fetchImplementation: responseFor(mixedPlaylist),
    });

    expect(result.entries).toHaveLength(2);
    expect(result.mediaCounts).toEqual({
      live: 2,
      vod: 1,
      series: 0,
      unknown: 0,
    });
    expect(result.skippedEntries).toBe(1);
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('indexes the catalogue on a first pass with live import off', async () => {
    // The case that failed in practice: a provider added for its films only.
    // Nothing can be selected before an import has found the categories, so
    // retaining nothing has to succeed or the provider can never be set up.
    const result = await inspectRemotePlaylist('http://provider.test/get.php', {
      fetchImplementation: responseFor(mixedPlaylist),
      includeLive: false,
    });

    expect(result.entries).toHaveLength(0);
    expect(result.categories).toEqual([
      { mediaType: 'vod', providerGroup: 'Movies', itemCount: 1 },
    ]);
  });

  it('refuses a catalogue-only import of a playlist with no catalogue', async () => {
    const liveOnly = [
      '#EXTM3U',
      '#EXTINF:-1 group-title="Finland",Yle TV1',
      'http://provider.test/user/pass/1',
    ].join('\n');

    await expect(
      inspectRemotePlaylist('http://provider.test/get.php', {
        fetchImplementation: responseFor(liveOnly),
        includeLive: false,
      }),
    ).rejects.toThrow(/no films or series/i);
  });

  it('rejects an HTML provider error page', async () => {
    await expect(
      inspectRemotePlaylist('http://provider.test/get.php', {
        fetchImplementation: responseFor(
          '<html>Login failed</html>',
          'text/html',
        ),
      }),
    ).rejects.toThrow(/unexpected text\/html/);
  });

  it('enforces the configured byte limit while streaming', async () => {
    await expect(
      inspectRemotePlaylist('http://provider.test/get.php', {
        fetchImplementation: responseFor(mixedPlaylist),
        maxBytes: 20,
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it('keeps a bounded default above a realistically selected catalogue', () => {
    // The production catalogue that exposed the old 100,000-entry ceiling has
    // 165,586 selected films and episodes. Keep this regression explicit while
    // retaining a finite denial-of-service bound.
    expect(DEFAULT_MAX_RETAINED_ENTRIES).toBeGreaterThan(165_586);
  });

  it('reports a selected-entry capacity failure without exposing a URL', async () => {
    await expect(
      inspectRemotePlaylist('http://provider.test/get.php?password=synthetic', {
        fetchImplementation: responseFor(mixedPlaylist),
        maxRetainedEntries: 1,
      }),
    ).rejects.toMatchObject({
      name: 'PlaylistEntryLimitError',
      limit: 1,
      message:
        'Playlist contains more than 1 selected entries. Disable some movie or series categories, or increase PLAYLIST_MAX_RETAINED_ENTRIES.',
    } satisfies Partial<PlaylistEntryLimitError>);
  });

  it.each([
    [503, true],
    [429, true],
    [401, false],
    [404, false],
  ])(
    'classifies provider HTTP %i retryability without exposing the URL',
    async (status, retryable) => {
      const request = inspectRemotePlaylist(
        'http://provider.test/get.php?token=synthetic',
        {
          fetchImplementation: async () => new Response('', { status }),
        },
      );

      await expect(request).rejects.toMatchObject({
        name: 'ProviderHttpError',
        message: `Provider returned HTTP ${status}`,
        status,
        retryable,
      } satisfies Partial<ProviderHttpError>);
    },
  );
});
