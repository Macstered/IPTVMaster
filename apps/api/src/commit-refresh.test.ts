import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { commitRefresh } from './commit-refresh.js';

describe('refresh completion time', () => {
  it('records the wall clock after commit, and reports the commit stage', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const report = vi.fn();
    await commitRefresh(
      { query: query as unknown as PoolClient['query'] },
      'synthetic-id',
      report,
    );
    expect(report).toHaveBeenCalledWith('committing');
    expect(query.mock.calls[0]).toEqual(['COMMIT']);
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('clock_timestamp()'),
      ['synthetic-id'],
    ]);
  });
  it('does not stamp success when commit fails', async () => {
    const query = vi.fn(async () => {
      throw new Error('Commit failed');
    });
    await expect(
      commitRefresh(
        { query: query as unknown as PoolClient['query'] },
        'synthetic-id',
      ),
    ).rejects.toThrow('Commit failed');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('keeps a committed snapshot successful if the optional timestamp correction fails', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('Connection lost'));
    await expect(
      commitRefresh({ query: query as PoolClient['query'] }, 'synthetic-id'),
    ).resolves.toBeUndefined();
  });
});
