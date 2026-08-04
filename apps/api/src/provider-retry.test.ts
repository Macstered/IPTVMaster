import { ProviderHttpError, SnapshotRejectedError } from '@iptvmaster/core';
import { describe, expect, it, vi } from 'vitest';

import {
  isRetryableProviderError,
  withProviderRetry,
} from './provider-retry.js';

describe('provider retry policy', () => {
  it('retries transient failures with bounded exponential backoff', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ProviderHttpError(503))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue('ok');
    const sleep = vi.fn(async () => undefined);

    await expect(
      withProviderRetry(operation, {
        maxAttempts: 3,
        initialDelayMs: 25,
        maxDelayMs: 40,
        sleep,
      }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[25], [40]]);
  });

  it('does not retry credentials, missing feeds, or rejected snapshots', async () => {
    for (const error of [
      new ProviderHttpError(401),
      new ProviderHttpError(404),
      new SnapshotRejectedError('unsafe snapshot'),
      new Error('Provider response is not an M3U playlist'),
    ]) {
      const operation = vi.fn(async () => {
        throw error;
      });
      await expect(
        withProviderRetry(operation, {
          maxAttempts: 3,
          sleep: vi.fn(async () => undefined),
        }),
      ).rejects.toBe(error);
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it('recognizes timeout and common network errors', () => {
    expect(isRetryableProviderError(new Error('invalid feed'))).toBe(false);
    expect(
      isRetryableProviderError(new DOMException('timeout', 'TimeoutError')),
    ).toBe(true);
    const networkError = Object.assign(new Error('connection reset'), {
      code: 'ECONNRESET',
    });
    expect(isRetryableProviderError(networkError)).toBe(true);
  });
});
