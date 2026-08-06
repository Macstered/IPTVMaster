import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type {
  AuthRepository,
  NewAdministrator,
  NewAdminSession,
  StoredAdministrator,
  StoredAdminSession,
} from './auth.js';

class MemoryAuthRepository implements AuthRepository {
  administrator: StoredAdministrator | null = null;
  sessions = new Map<string, StoredAdminSession>();

  async countAdministrators(): Promise<number> {
    return this.administrator ? 1 : 0;
  }

  async createAdministrator(
    administrator: NewAdministrator,
  ): Promise<StoredAdministrator | null> {
    if (this.administrator) return null;
    this.administrator = {
      id: '00000000-0000-4000-8000-000000000901',
      ...administrator,
    };
    return this.administrator;
  }

  async findAdministrator(
    normalizedUsername: string,
  ): Promise<StoredAdministrator | null> {
    return this.administrator?.normalizedUsername === normalizedUsername
      ? this.administrator
      : null;
  }

  async createSession(session: NewAdminSession): Promise<void> {
    if (!this.administrator) throw new Error('Missing administrator');
    this.sessions.set(session.tokenHash, {
      ...session,
      username: this.administrator.username,
    });
  }

  async findSession(tokenHash: string): Promise<StoredAdminSession | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async cleanupExpiredSessions(): Promise<number> {
    const before = this.sessions.size;
    const now = Date.now();
    for (const [tokenHash, session] of this.sessions) {
      if (Date.parse(session.expiresAt) <= now) this.sessions.delete(tokenHash);
    }
    return before - this.sessions.size;
  }

  async healthCheck(): Promise<void> {}
}

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

function responseCookies(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): Map<string, string> {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header)
    ? header
    : header
      ? [String(header)]
      : [];
  return new Map(
    values.map((value) => {
      const pair = value.split(';', 1)[0] ?? '';
      const separator = pair.indexOf('=');
      return [
        pair.slice(0, separator),
        decodeURIComponent(pair.slice(separator + 1)),
      ];
    }),
  );
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

describe('administrator authentication API', () => {
  it('protects the editor API with setup, session, CSRF, and logout flows', async () => {
    const repository = new MemoryAuthRepository();
    const app = await buildApp({
      authRepository: repository,
      sessionTtlMs: 60 * 60 * 1_000,
    });
    applications.push(app);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );

    const initialStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/status',
    });
    expect(initialStatus.json()).toMatchObject({
      enabled: true,
      setupRequired: true,
      authenticated: false,
    });

    const protectedResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/system/capabilities',
    });
    expect(protectedResponse.statusCode).toBe(401);

    const foreignSetup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      headers: { origin: 'http://attacker.test' },
      payload: { username: 'admin', password: 'long-local-password' },
    });
    expect(foreignSetup.statusCode).toBe(403);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      headers: { origin: 'http://localhost:80' },
      payload: { username: 'Admin.User', password: 'long-local-password' },
    });
    expect(setup.statusCode).toBe(201);
    expect(setup.json()).toMatchObject({
      setupRequired: false,
      authenticated: true,
      username: 'Admin.User',
    });
    const cookies = responseCookies(setup);
    const csrfToken = cookies.get('iptvmaster_csrf');
    expect(cookies.get('iptvmaster_session')).toBeTruthy();
    expect(csrfToken).toBeTruthy();
    const cookie = cookieHeader(cookies);

    const authenticatedStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/status',
      headers: { cookie },
    });
    expect(authenticatedStatus.json()).toMatchObject({
      authenticated: true,
      username: 'Admin.User',
    });

    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/event-time/preview',
      headers: { cookie },
      payload: {
        name: '17:00 Test event',
        policy: {
          sourceTimeZone: 'Europe/Stockholm',
          displayTimeZone: 'Europe/Helsinki',
          numericDateOrder: 'day-month',
          referenceDate: '2026-08-04',
        },
      },
    });
    expect(missingCsrf.statusCode).toBe(403);

    const validMutation = await app.inject({
      method: 'POST',
      url: '/api/v1/event-time/preview',
      headers: {
        cookie,
        origin: 'http://localhost:80',
        'x-iptvmaster-csrf': csrfToken ?? '',
      },
      payload: {
        name: '17:00 Test event',
        policy: {
          sourceTimeZone: 'Europe/Stockholm',
          displayTimeZone: 'Europe/Helsinki',
          numericDateOrder: 'day-month',
          referenceDate: '2026-08-04',
        },
      },
    });
    expect(validMutation.statusCode).toBe(200);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie,
        origin: 'http://localhost:80',
        'x-iptvmaster-csrf': csrfToken ?? '',
      },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/system/capabilities',
      headers: { cookie },
    });
    expect(afterLogout.statusCode).toBe(401);

    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:80' },
      payload: { username: 'admin.user', password: 'wrong' },
    });
    expect(badLogin.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:80' },
      payload: { username: 'admin.user', password: 'long-local-password' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toBeTruthy();
  });

  it('marks secure cookies and HTTPS-only headers when configured', async () => {
    const repository = new MemoryAuthRepository();
    const app = await buildApp({
      authRepository: repository,
      secureCookies: true,
      developmentMode: false,
    });
    applications.push(app);

    const alternateLoopbackOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      headers: { origin: 'https://localhost:5173' },
      payload: { username: 'admin', password: 'another-long-password' },
    });
    expect(alternateLoopbackOrigin.statusCode).toBe(403);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      headers: { origin: 'https://localhost:80' },
      payload: { username: 'admin', password: 'another-long-password' },
    });

    const setCookie = setup.headers['set-cookie'];
    expect(
      Array.isArray(setCookie) ? setCookie.join(';') : setCookie,
    ).toContain('Secure');
    expect(setup.headers['strict-transport-security']).toContain('max-age=');
  });

  it('throttles repeated login failures by client address', async () => {
    const repository = new MemoryAuthRepository();
    const app = await buildApp({ authRepository: repository });
    applications.push(app);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      headers: { origin: 'http://localhost' },
      payload: { username: 'admin', password: 'rate-limit-password' },
    });
    expect(setup.statusCode).toBe(201);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://localhost' },
        payload: { username: 'admin', password: `wrong-password-${attempt}` },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    const blockedCorrectPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost' },
      payload: { username: 'admin', password: 'rate-limit-password' },
    });
    expect(blockedCorrectPassword.statusCode).toBe(429);
    expect(
      Number(blockedCorrectPassword.headers['retry-after']),
    ).toBeGreaterThan(0);
  });
});
