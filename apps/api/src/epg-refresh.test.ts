import { describe, expect, it, vi } from 'vitest';

import type { XmltvInspection } from '@iptvmaster/core';

import { EpgRefreshCoordinator, EpgScheduler } from './epg-refresh.js';
import type {
  SafeSource,
  SourceRepository,
  StoredEpgSummary,
} from './source-repository.js';

function inspection(): XmltvInspection {
  return {
    fingerprint: 'd'.repeat(64),
    totalBytes: 200,
    channels: [{ id: 'yle1', displayName: 'Yle TV1' }],
    programmes: [
      {
        channelId: 'yle1',
        start: '2026-08-04T15:00:00.000Z',
        title: 'News',
      },
    ],
    issues: [],
    issuesTruncated: false,
  };
}

function repository(): SourceRepository {
  const summary: StoredEpgSummary = {
    sourceId: '00000000-0000-4000-8000-000000000001',
    fingerprint: 'd'.repeat(64),
    importedAt: '2026-08-04T00:00:00.000Z',
    channelCount: 1,
    programmeCount: 1,
    issueCount: 0,
    unchanged: false,
  };
  return {
    createSource: vi.fn(),
    listSources: vi.fn(async (): Promise<SafeSource[]> => [
      {
        id: summary.sourceId,
        name: 'Synthetic',
        sourceType: 'm3u',
        sourceTimezone: 'Europe/Stockholm',
        displayTimezone: 'Europe/Helsinki',
        enabled: true,
        hasEpgUrl: true,
        createdAt: summary.importedAt,
        updatedAt: summary.importedAt,
      },
    ]),
    getSourceCredentials: vi.fn(async () => ({
      playlistUrl: 'http://provider.test/list',
      epgUrl: 'http://provider.test/guide',
    })),
    savePlaylistSnapshot: vi.fn(),
    saveEpgSnapshot: vi.fn(async () => summary),
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
    listOutputGroupPolicies: vi.fn(async () => []),
    createOutputProfile: vi.fn(),
    resolveOutputProfile: vi.fn(async () => null),
    revokeOutputProfile: vi.fn(async () => false),
  };
}

describe('EPG refresh automation', () => {
  it('imports XMLTV and records status', async () => {
    const data = repository();
    const coordinator = new EpgRefreshCoordinator(data, async () =>
      inspection(),
    );
    const result = await coordinator.refresh(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(result.summary?.programmeCount).toBe(1);
    expect(coordinator.listStates()[0]).toEqual(
      expect.objectContaining({ status: 'succeeded', programmeCount: 1 }),
    );
  });

  it('runs enabled XMLTV sources through the EPG scheduler', async () => {
    const data = repository();
    const coordinator = new EpgRefreshCoordinator(data, async () =>
      inspection(),
    );
    const logger = { info: vi.fn(), warn: vi.fn() };
    const scheduler = new EpgScheduler(data, coordinator, logger, {
      intervalMs: 43_200_000,
      initialDelayMs: 60_000,
    });
    await scheduler.runNow();
    expect(data.saveEpgSnapshot).toHaveBeenCalledTimes(1);
    expect(scheduler.status().intervalMinutes).toBe(720);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
