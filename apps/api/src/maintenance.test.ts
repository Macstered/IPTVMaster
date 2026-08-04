import { describe, expect, it, vi } from 'vitest';

import { MaintenanceScheduler } from './maintenance.js';

describe('database maintenance automation', () => {
  it('removes expired sessions and exposes the result', async () => {
    const task = { cleanupExpiredSessions: vi.fn(async () => 4) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const scheduler = new MaintenanceScheduler(task, logger, {
      intervalMs: 86_400_000,
      initialDelayMs: 300_000,
    });

    await scheduler.runNow();

    expect(task.cleanupExpiredSessions).toHaveBeenCalledTimes(1);
    expect(scheduler.status()).toEqual(
      expect.objectContaining({
        running: false,
        intervalMinutes: 1_440,
        lastExpiredSessionsRemoved: 4,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      { expiredSessionsRemoved: 4 },
      'Database maintenance finished',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('records a safe failure and permits the next run', async () => {
    const task = {
      cleanupExpiredSessions: vi
        .fn<() => Promise<number>>()
        .mockRejectedValueOnce(new Error('temporary database failure'))
        .mockResolvedValue(0),
    };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const scheduler = new MaintenanceScheduler(task, logger, {
      intervalMs: 86_400_000,
      initialDelayMs: 300_000,
    });

    await scheduler.runNow();
    expect(scheduler.status().lastSafeError).toBe('temporary database failure');
    await scheduler.runNow();
    expect(scheduler.status().lastSafeError).toBeUndefined();
    expect(task.cleanupExpiredSessions).toHaveBeenCalledTimes(2);
  });
});
