import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

describe('IPTVMaster API', () => {
  it('reports health', async () => {
    const app = await buildApp();
    applications.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'iptvmaster-api',
    });
  });

  it('previews Stockholm-to-Helsinki event localization', async () => {
    const app = await buildApp();
    applications.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/event-time/preview',
      payload: {
        name: '17:00 Montreal ATP Tennis 8/4',
        policy: {
          sourceTimeZone: 'Europe/Stockholm',
          displayTimeZone: 'Europe/Helsinki',
          numericDateOrder: 'month-day',
          referenceDate: '2026-08-04',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        status: 'localized',
        localizedName: '18:00 Montreal ATP Tennis 8/4',
      }),
    );
  });

  it('returns only redacted stream URLs from playlist previews', async () => {
    const app = await buildApp();
    applications.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/playlists/preview',
      payload: {
        playlist:
          '#EXTM3U\n#EXTINF:-1 tvg-name="Yle TV1" group-title="Finland",Yle TV1\nhttp://provider.test/private-user/private-pass/1\n',
        eventGroups: [],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('private-user');
    expect(response.body).not.toContain('private-pass');
    expect(response.json().entries[0].streamUrl).toBe(
      'http://provider.test/[redacted]',
    );
  });
});
