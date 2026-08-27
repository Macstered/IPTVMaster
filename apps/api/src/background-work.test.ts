import { describe, expect, it } from 'vitest';

import { BackgroundWorkQueue } from './background-work.js';

describe('BackgroundWorkQueue', () => {
  it('serializes jobs and continues after a rejection', async () => {
    const queue = new BackgroundWorkQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push('first-start');
      await firstGate;
      events.push('first-end');
      throw new Error('synthetic failure');
    });
    const second = queue.run(async () => {
      events.push('second');
      return 42;
    });

    await Promise.resolve();
    expect(events).toEqual(['first-start']);
    releaseFirst?.();
    await expect(first).rejects.toThrow('synthetic failure');
    await expect(second).resolves.toBe(42);
    expect(events).toEqual(['first-start', 'first-end', 'second']);
  });
});
