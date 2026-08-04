import { describe, expect, it } from 'vitest';

import {
  createPasswordRecord,
  hashAuthToken,
  LoginRateLimiter,
  normalizeUsername,
  verifyPassword,
} from './auth.js';

describe('administrator authentication primitives', () => {
  it('normalizes usernames and verifies scrypt password records', async () => {
    const record = await createPasswordRecord('a sufficiently long password');

    expect(normalizeUsername('Admin.User')).toBe('admin.user');
    await expect(
      verifyPassword(
        'a sufficiently long password',
        record.passwordSalt,
        record.passwordHash,
      ),
    ).resolves.toBe(true);
    await expect(
      verifyPassword(
        'incorrect password',
        record.passwordSalt,
        record.passwordHash,
      ),
    ).resolves.toBe(false);
    expect(hashAuthToken('token')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks repeated failures for a bounded window and resets on success', () => {
    const limiter = new LoginRateLimiter(3, 60_000);

    expect(limiter.recordFailure('client', 1_000)).toBe(0);
    expect(limiter.recordFailure('client', 2_000)).toBe(0);
    expect(limiter.recordFailure('client', 3_000)).toBe(60);
    expect(limiter.retryAfterSeconds('client', 33_000)).toBe(30);
    limiter.reset('client');
    expect(limiter.retryAfterSeconds('client', 33_000)).toBe(0);
  });
});
