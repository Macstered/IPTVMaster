import { describe, expect, it } from 'vitest';

import {
  normalizeXtreamServer,
  parseXtreamAccountStatus,
  parseXtreamInput,
  xtreamGuideUrl,
  xtreamPlaylistUrl,
  xtreamStreamUrl,
} from './xtream.js';

const account = {
  server: 'http://panel.example:2095',
  username: 'user',
  password: 'p@ss word',
};

describe('xtream panel addresses', () => {
  it('accepts a bare host and assumes HTTP', () => {
    expect(parseXtreamInput('panel.example:2095')).toEqual({
      server: 'http://panel.example:2095',
    });
  });

  it('keeps an explicit HTTPS origin and drops any path', () => {
    expect(parseXtreamInput('https://panel.example/c/')).toEqual({
      server: 'https://panel.example',
    });
  });

  it('decomposes a full get.php link into its parts', () => {
    expect(
      parseXtreamInput(
        'http://panel.example:2095/get.php?username=user&password=secret&type=m3u_plus',
      ),
    ).toEqual({
      server: 'http://panel.example:2095',
      username: 'user',
      password: 'secret',
    });
  });

  it('refuses a protocol that is not HTTP or HTTPS', () => {
    expect(parseXtreamInput('ftp://panel.example')).toEqual({});
    expect(() => normalizeXtreamServer('ftp://panel.example')).toThrow(
      /HTTP or HTTPS/,
    );
  });
});

describe('xtream endpoints', () => {
  it('requests the m3u_plus variant, which carries the grouping attributes', () => {
    const url = new URL(xtreamPlaylistUrl(account));
    expect(url.origin + url.pathname).toBe('http://panel.example:2095/get.php');
    expect(url.searchParams.get('type')).toBe('m3u_plus');
    expect(url.searchParams.get('output')).toBe('ts');
  });

  it('escapes credentials rather than pasting them into the query', () => {
    const url = new URL(xtreamPlaylistUrl(account));
    expect(url.searchParams.get('password')).toBe('p@ss word');
    expect(url.toString()).toContain('password=p%40ss+word');
  });

  it('derives the guide from the same account', () => {
    const url = new URL(xtreamGuideUrl(account));
    expect(url.origin + url.pathname).toBe(
      'http://panel.example:2095/xmltv.php',
    );
    expect(url.searchParams.get('username')).toBe('user');
  });

  it('builds an encoded native series episode URL', () => {
    const url = new URL(xtreamStreamUrl(account, 'series', '11903', 'mkv'));
    expect(url.pathname).toBe('/series/user/p%40ss%20word/11903.mkv');
  });
});

describe('xtream account status', () => {
  it('reads the fields panels send as strings', () => {
    expect(
      parseXtreamAccountStatus({
        user_info: {
          status: 'Active',
          exp_date: '1794614400',
          active_cons: '2',
          max_connections: '3',
          is_trial: '0',
        },
      }),
    ).toEqual({
      status: 'Active',
      expiresAt: new Date(1794614400 * 1000).toISOString(),
      activeConnections: 2,
      maxConnections: 3,
      trial: false,
    });
  });

  it('omits the expiry for an account that does not expire', () => {
    const status = parseXtreamAccountStatus({
      user_info: { status: 'Active', exp_date: null },
    });
    expect(status.expiresAt).toBeUndefined();
    expect(status.status).toBe('Active');
  });

  it('returns nothing usable for a response that is not a panel reply', () => {
    expect(parseXtreamAccountStatus('<html>404</html>')).toEqual({});
    expect(parseXtreamAccountStatus({ error: 'nope' })).toEqual({});
  });
});
