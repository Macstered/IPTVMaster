import { describe, expect, it, vi } from 'vitest';
import type { PlaylistInspection, XmltvInspection } from '@iptvmaster/core';
import { BackgroundWorkQueue } from './background-work.js';
import {
  PlaylistRefreshCoordinator,
  PlaylistScheduler,
} from './playlist-refresh.js';
import { EpgRefreshCoordinator } from './epg-refresh.js';
import type { SourceRepository } from './source-repository.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const playlist: PlaylistInspection = {
  fingerprint: 'a'.repeat(64),
  entries: [],
  totalBytes: 10,
  issues: [],
  mediaCounts: { live: 0, vod: 0, series: 0, unknown: 0 },
  skippedEntries: 0,
  categories: [],
};
const guide: XmltvInspection = {
  fingerprint: 'b'.repeat(64),
  totalBytes: 10,
  channels: [],
  programmes: [],
  issues: [],
  issuesTruncated: false,
};

function repository() {
  return {
    listSources: vi.fn(async () => [{ id: 'scheduled', enabled: true }]),
    getSourceCredentials: vi.fn(async () => ({
      playlistUrl: 'https://fixture.test/list',
      epgUrl: 'https://fixture.test/guide',
    })),
    getEpgSourceRefreshTarget: vi.fn(async () => ({
      kind: 'provider',
      ownerSourceId: 'manual',
      epgUrl: 'https://fixture.test/guide',
    })),
    savePlaylistSnapshot: vi.fn(async () => ({
      liveCount: 1,
      unchanged: false,
    })),
    saveEpgSnapshot: vi.fn(async () => ({
      channelCount: 1,
      programmeCount: 1,
      unchanged: false,
    })),
  };
}

describe('shared refresh admission', () => {
  it('queues manual, scheduled, EPG and maintenance jobs and deduplicates while waiting', async () => {
    const queue = new BackgroundWorkQueue();
    const firstGate = gate();
    const work = repository();
    const data = work as unknown as SourceRepository;
    const inspector = vi.fn(async () => {
      await firstGate.promise;
      return playlist;
    });
    const playlists = new PlaylistRefreshCoordinator(
      data,
      inspector,
      {},
      queue.run.bind(queue),
    );
    const epgInspector = vi.fn(async () => guide);
    const epgs = new EpgRefreshCoordinator(
      data,
      epgInspector,
      {},
      queue.run.bind(queue),
    );
    const scheduler = new PlaylistScheduler(
      data,
      playlists,
      { info: vi.fn(), warn: vi.fn() },
      { intervalMs: 10000, initialDelayMs: 10000 },
    );

    const manual = playlists.refresh('manual');
    const scheduled = scheduler.runNow();
    await vi.waitFor(() => expect(playlists.listStates()).toHaveLength(2));
    const epg = epgs.refresh('manual');
    const maintenance = vi.fn(async () => undefined);
    const cleanup = queue.run(maintenance);
    expect(
      playlists.listStates().find((state) => state.sourceId === 'scheduled')
        ?.progress?.stage,
    ).toBe('queued');
    expect(epgs.listStates()[0]?.progress?.stage).toBe('queued');
    expect((await playlists.refresh('scheduled')).status).toBe(
      'already-running',
    );
    // Provider-guide and provider-card endpoints resolve to the same job.
    expect((await epgs.refreshEpgSource('provider-guide')).status).toBe(
      'already-running',
    );
    expect(epgInspector).not.toHaveBeenCalled();
    expect(maintenance).not.toHaveBeenCalled();
    firstGate.release();
    await Promise.all([manual, scheduled, epg, cleanup]);
    expect(inspector).toHaveBeenCalledTimes(2);
    expect(epgInspector).toHaveBeenCalledTimes(1);
    expect(work.saveEpgSnapshot).toHaveBeenCalledTimes(1);
    expect(maintenance).toHaveBeenCalledTimes(1);
    expect(
      playlists
        .listStates()
        .every((state) => state.progress?.stage === 'completed'),
    ).toBe(true);
  });

  it('releases the shared queue after a failed import and permits a retry', async () => {
    const queue = new BackgroundWorkQueue();
    const work = repository();
    const inspector = vi
      .fn<() => Promise<PlaylistInspection>>()
      .mockRejectedValueOnce(new Error('Synthetic parse failure'))
      .mockResolvedValue(playlist);
    const coordinator = new PlaylistRefreshCoordinator(
      work as unknown as SourceRepository,
      inspector,
      { maxAttempts: 1 },
      queue.run.bind(queue),
    );
    await expect(coordinator.refresh('manual')).rejects.toThrow(
      'Synthetic parse failure',
    );
    expect(coordinator.listStates()[0]?.progress?.stage).toBe('failed');
    await expect(coordinator.refresh('manual')).resolves.toMatchObject({
      status: 'completed',
    });
    expect(work.savePlaylistSnapshot).toHaveBeenCalledTimes(1);
  });
});
