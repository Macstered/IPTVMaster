import { describe, expect, it, vi } from 'vitest';

import { ProviderHttpError, type PlaylistInspection } from '@iptvmaster/core';

import {
  PlaylistRefreshCoordinator,
  PlaylistScheduler,
  safeRefreshError,
} from './playlist-refresh.js';
import type {
  SafeSource,
  SourceCredentials,
  SourceRepository,
  StoredSnapshotSummary,
} from './source-repository.js';

function source(): SafeSource {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Synthetic source',
    sourceType: 'm3u',
    sourceTimezone: 'Europe/Stockholm',
    displayTimezone: 'Europe/Helsinki',
    enabled: true,
    hasEpgUrl: false,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  };
}

function inspection(): PlaylistInspection {
  return {
    fingerprint: 'a'.repeat(64),
    totalBytes: 100,
    entries: [],
    issues: [],
    mediaCounts: { live: 0, vod: 0, series: 0, unknown: 0 },
    skippedEntries: 0,
  };
}

function repository(
  overrides: Partial<SourceRepository> = {},
): SourceRepository {
  const base: SourceRepository = {
    createSource: vi.fn(),
    updateSource: vi.fn(async () => null),
    deleteSource: vi.fn(async () => null),
    listSources: vi.fn(async () => [source()]),
    getSourceCredentials: vi.fn(async (): Promise<SourceCredentials> => ({
      playlistUrl: 'http://provider.test/synthetic',
    })),
    savePlaylistSnapshot: vi.fn(async (): Promise<StoredSnapshotSummary> => ({
      id: '00000000-0000-4000-8000-000000000002',
      sourceId: source().id,
      fingerprint: 'a'.repeat(64),
      importedAt: '2026-08-04T00:00:00.000Z',
      liveCount: 42,
      skippedEntries: 0,
      issueCount: 0,
      unchanged: false,
    })),
    listSourceHistory: vi.fn(async () => ({ snapshots: [], activity: [] })),
    activateSnapshot: vi.fn(async () => null),
    saveEpgSnapshot: vi.fn(),
    getLatestEpg: vi.fn(async () => ({ channels: [], programmes: [] })),
    getLatestPlaylistEntries: vi.fn(async () => []),
    listGroups: vi.fn(async () => []),
    saveGroupPolicy: vi.fn(),
    listChannels: vi.fn(async (_sourceId, filters) => ({
      channels: [],
      total: 0,
      limit: filters.limit,
      offset: filters.offset,
    })),
    updateChannel: vi.fn(async () => null),
    bulkUpdateChannels: vi.fn(async () => ({ updatedCount: 0 })),
    getReconciliationReview: vi.fn(async () => ({
      unresolvedChannels: [],
      candidates: [],
      ambiguousCount: 0,
      missingCount: 0,
      newCount: 0,
      candidateTotal: 0,
      truncated: false,
    })),
    resolveChannelMatch: vi.fn(async () => null),
    unlockChannelMatch: vi.fn(async () => null),
    getSystemStatus: vi.fn(async () => ({
      sources: [],
      outputProfileCount: 0,
    })),
    bulkUpdateGroupPolicies: vi.fn(async () => ({ updatedCount: 0 })),
    getAutomationOverrides: vi.fn(async () => ({})),
    saveAutomationOverrides: vi.fn(async () => ({})),
    getChannelLogoUrl: vi.fn(async () => null),
    getEpgChannelIconUrl: vi.fn(async () => null),
    listEpgSources: vi.fn(async () => []),
    createCustomEpgSource: vi.fn(async () => ({
      id: 'epg-custom-1',
      kind: 'custom' as const,
      name: 'Custom',
      enabled: true,
      channelCount: 0,
      programmeCount: 0,
    })),
    removeEpgSource: vi.fn(async () => false),
    getEpgSourceRefreshTarget: vi.fn(async () => null),
    saveEpgSnapshotForEpgSource: vi.fn(async () => ({
      sourceId: 'epg-custom-1',
      fingerprint: 'f'.repeat(64),
      importedAt: '2026-08-06T00:00:00.000Z',
      channelCount: 0,
      programmeCount: 0,
      issueCount: 0,
      unchanged: false,
    })),
    getEpgMappingReview: vi.fn(async () => ({
      mappings: [],
      matchedCount: 0,
      missingCount: 0,
      ambiguousCount: 0,
      manualCount: 0,
      excludedCount: 0,
      total: 0,
      truncated: false,
    })),
    searchEpgChannels: vi.fn(async () => ({
      channels: [],
      total: 0,
      truncated: false,
    })),
    saveManualEpgMapping: vi.fn(async () => false),
    unlockEpgMapping: vi.fn(async () => false),
    listOutputGroupPolicies: vi.fn(async () => []),
    createOutputProfile: vi.fn(),
    listOutputProfiles: vi.fn(async () => []),
    resolveOutputProfile: vi.fn(async () => null),
    revokeOutputProfile: vi.fn(async () => false),
  };
  return Object.assign(base, overrides);
}

describe('playlist refresh automation', () => {
  it('coalesces overlapping refresh requests for one source', async () => {
    let releaseInspection: (() => void) | undefined;
    const inspector = vi.fn(
      () =>
        new Promise<PlaylistInspection>((resolve) => {
          releaseInspection = () => resolve(inspection());
        }),
    );
    const data = repository();
    const coordinator = new PlaylistRefreshCoordinator(data, inspector);

    const first = coordinator.refresh(source().id);
    const second = await coordinator.refresh(source().id);
    expect(second.status).toBe('already-running');
    expect(inspector).toHaveBeenCalledTimes(1);
    releaseInspection?.();
    await expect(first).resolves.toEqual(
      expect.objectContaining({ status: 'completed' }),
    );
    expect(data.savePlaylistSnapshot).toHaveBeenCalledTimes(1);
  });

  it('refreshes every enabled source and exposes safe status', async () => {
    const data = repository();
    const coordinator = new PlaylistRefreshCoordinator(data, async () =>
      inspection(),
    );
    const logger = { info: vi.fn(), warn: vi.fn() };
    const scheduler = new PlaylistScheduler(data, coordinator, logger, {
      intervalMs: 7_200_000,
      initialDelayMs: 30_000,
    });

    await scheduler.runNow();

    expect(data.savePlaylistSnapshot).toHaveBeenCalledTimes(1);
    expect(scheduler.status()).toEqual(
      expect.objectContaining({
        running: false,
        intervalMinutes: 120,
        sourceStates: [
          expect.objectContaining({ status: 'succeeded', liveCount: 42 }),
        ],
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('retries a transient provider failure before saving once', async () => {
    const data = repository();
    const inspector = vi
      .fn<() => Promise<PlaylistInspection>>()
      .mockRejectedValueOnce(new ProviderHttpError(503))
      .mockResolvedValue(inspection());
    const coordinator = new PlaylistRefreshCoordinator(data, inspector, {
      maxAttempts: 3,
      sleep: vi.fn(async () => undefined),
    });

    const result = await coordinator.refresh(source().id);

    expect(result.attempts).toBe(2);
    expect(inspector).toHaveBeenCalledTimes(2);
    expect(data.savePlaylistSnapshot).toHaveBeenCalledTimes(1);
    expect(coordinator.listStates()[0]?.attempts).toBe(2);
  });

  it('redacts provider URLs and credential query values from errors', () => {
    expect(
      safeRefreshError(
        new Error(
          'Failed http://provider.test/path?username=private&password=secret',
        ),
      ),
    ).toBe('Failed [redacted-url]');
  });
});
