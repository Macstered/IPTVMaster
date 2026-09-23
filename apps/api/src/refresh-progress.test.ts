import { describe, expect, it } from 'vitest';
import { RefreshProgress } from './refresh-progress.js';

describe('refresh progress', () => {
  it('measures queue, retries, batches and commit without resetting stage time', () => {
    let time = 0;
    const progress = new RefreshProgress(() => time);
    time = 200;
    progress.report('downloading');
    time = 500;
    progress.report('downloading');
    time = 800;
    progress.report('saving', 0, 2000);
    time = 1200;
    progress.report('saving', 1000, 2000);
    expect(progress.snapshot()).toMatchObject({
      stage: 'saving',
      processed: 1000,
      total: 2000,
      stageElapsedMs: 400,
    });
    time = 1500;
    progress.report('committing');
    time = 1800;
    progress.report('completed');
    time = 10000;
    expect(progress.snapshot()).toMatchObject({
      stage: 'completed',
      elapsedMs: 1800,
      stageDurationsMs: {
        queued: 200,
        downloading: 600,
        saving: 700,
        committing: 300,
      },
    });
    expect(progress.snapshot()).not.toHaveProperty('processed');
  });
});
