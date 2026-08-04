import { describe, expect, it } from 'vitest';

import { inspectRemotePlaylist } from './source-import.js';

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
});
