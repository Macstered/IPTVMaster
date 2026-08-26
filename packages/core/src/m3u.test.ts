import { describe, expect, it } from 'vitest';

import {
  classifyMediaUrl,
  parseExtinf,
  parseM3uText,
  redactStreamUrl,
  serializeM3u,
} from './m3u.js';

describe('M3U parsing', () => {
  it('parses quoted metadata and a provider logo URL containing commas', () => {
    const line =
      '#EXTINF:-1 tvg-id="yle1.fi" tvg-name="Yle TV1" tvg-logo="http://logos.test/image,large.png" group-title="Finland",Yle TV1 HD';
    const entry = parseExtinf(line, 2);

    expect(entry).not.toBeNull();
    expect(entry?.name).toBe('Yle TV1 HD');
    expect(entry?.attributes['group-title']).toBe('Finland');
    expect(entry?.attributes['tvg-logo']).toContain('image,large.png');
  });

  it('classifies common live, VOD, and series URL shapes', () => {
    expect(classifyMediaUrl('http://provider.test/user/pass/12345')).toBe(
      'live',
    );
    expect(
      classifyMediaUrl('http://provider.test/live/user/pass/12345.ts'),
    ).toBe('live');
    expect(classifyMediaUrl('http://provider.test/movie/user/pass/1.mkv')).toBe(
      'vod',
    );
    expect(
      classifyMediaUrl('http://provider.test/series/user/pass/1.mp4'),
    ).toBe('series');
  });

  it('reports incomplete entries without treating a failed snapshot as valid data', async () => {
    const parsed = await parseM3uText(
      '#EXTM3U\n#EXTINF:-1 group-title="Finland",Yle TV1\n',
    );

    expect(parsed.entries).toHaveLength(0);
    expect(parsed.issues).toEqual([
      expect.objectContaining({ code: 'missing-url', lineNumber: 2 }),
    ]);
  });

  it('round-trips a parsed playlist', async () => {
    const source =
      '#EXTM3U\n#EXTINF:-1 tvg-name="Yle TV1" group-title="Finland",Yle TV1\nhttp://provider.test/u/p/1\n';
    const parsed = await parseM3uText(source);
    const generated = serializeM3u(parsed.entries);
    const reparsed = await parseM3uText(generated);

    expect(generated).toBe(
      '#EXTM3U\r\n#EXTINF:-1 tvg-name="Yle TV1" group-title="Finland",Yle TV1\r\nhttp://provider.test/u/p/1\r\n',
    );
    expect(reparsed.entries).toHaveLength(1);
    expect(reparsed.entries[0]?.name).toBe('Yle TV1');
    expect(reparsed.entries[0]?.mediaType).toBe('live');
  });

  it('redacts the entire sensitive path and query string', () => {
    expect(
      redactStreamUrl(
        'http://provider.test:2095/user/password/123?token=secret',
      ),
    ).toBe('http://provider.test:2095/[redacted]');
  });
});
