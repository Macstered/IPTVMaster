import { afterEach, describe, expect, it } from 'vitest';

import {
  SnapshotRejectedError,
  type M3uEntry,
  type PlaylistInspection,
} from '@iptvmaster/core';

import { buildApp } from './app.js';
import type {
  CreateSourceInput,
  SafeSource,
  SourceCredentials,
  SourceRepository,
  StoredSnapshotSummary,
} from './source-repository.js';

const applications: Awaited<ReturnType<typeof buildApp>>[] = [];

function syntheticProviderUrl(path: string): string {
  const url = new URL(path, 'http://provider.test');
  url.searchParams.set('username', 'synthetic-user');
  url.searchParams.set('password', 'synthetic-secret');
  return url.toString();
}

class MemorySourceRepository implements SourceRepository {
  readonly inputs: CreateSourceInput[] = [];
  readonly sources: SafeSource[] = [];
  latestEntries: M3uEntry[] = [];

  async createSource(input: CreateSourceInput): Promise<SafeSource> {
    this.inputs.push(input);
    const source: SafeSource = {
      id: '00000000-0000-4000-8000-000000000001',
      name: input.name,
      sourceType: input.sourceType,
      sourceTimezone: input.sourceTimezone,
      displayTimezone: input.displayTimezone,
      enabled: true,
      hasEpgUrl: input.credentials.epgUrl !== undefined,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    };
    this.sources.push(source);
    return source;
  }

  async listSources(): Promise<SafeSource[]> {
    return this.sources;
  }

  async getSourceCredentials(): Promise<SourceCredentials | null> {
    return this.inputs[0]?.credentials ?? null;
  }

  async savePlaylistSnapshot(
    sourceId: string,
    inspection: PlaylistInspection,
  ): Promise<StoredSnapshotSummary> {
    this.latestEntries = inspection.entries;
    return {
      id: '00000000-0000-4000-8000-000000000002',
      sourceId,
      fingerprint: inspection.fingerprint,
      importedAt: '2026-08-04T00:00:00.000Z',
      liveCount: inspection.entries.length,
      skippedEntries: inspection.skippedEntries,
      issueCount: inspection.issues.length,
      unchanged: false,
    };
  }

  async getLatestPlaylistEntries(): Promise<M3uEntry[]> {
    return this.latestEntries;
  }
}

class RejectingSourceRepository extends MemorySourceRepository {
  override async savePlaylistSnapshot(): Promise<StoredSnapshotSummary> {
    throw new SnapshotRejectedError('Synthetic suspicious count drop');
  }
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

describe('IPTVMaster API', () => {
  it('reports health', async () => {
    const app = await buildApp();
    applications.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'iptvmaster-api',
    });
  });

  it('previews Stockholm-to-Helsinki event localization', async () => {
    const app = await buildApp();
    applications.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/event-time/preview',
      payload: {
        name: '17:00 Montreal ATP Tennis 8/4',
        policy: {
          sourceTimeZone: 'Europe/Stockholm',
          displayTimeZone: 'Europe/Helsinki',
          numericDateOrder: 'month-day',
          referenceDate: '2026-08-04',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        status: 'localized',
        localizedName: '18:00 Montreal ATP Tennis 8/4',
      }),
    );
  });

  it('returns only redacted stream URLs from playlist previews', async () => {
    const app = await buildApp();
    applications.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/playlists/preview',
      payload: {
        playlist:
          '#EXTM3U\n#EXTINF:-1 tvg-name="Yle TV1" group-title="Finland",Yle TV1\nhttp://provider.test/private-user/private-pass/1\n',
        eventGroups: [],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('private-user');
    expect(response.body).not.toContain('private-pass');
    expect(response.json().entries[0].streamUrl).toBe(
      'http://provider.test/[redacted]',
    );
  });

  it('persists a source without returning its credential URLs', async () => {
    const repository = new MemorySourceRepository();
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources',
      payload: {
        name: 'Home provider',
        sourceType: 'm3u',
        playlistUrl: syntheticProviderUrl('/get.php'),
        epgUrl: syntheticProviderUrl('/xmltv.php'),
        sourceTimezone: 'Europe/Stockholm',
        displayTimezone: 'Europe/Helsinki',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain('provider.test');
    expect(response.body).not.toContain('password');
    expect(response.json().source).toEqual(
      expect.objectContaining({
        name: 'Home provider',
        hasEpgUrl: true,
      }),
    );
    expect(repository.inputs[0]?.credentials.playlistUrl).toContain(
      'username=synthetic-user',
    );
  });

  it('previews a saved source import without exposing its URL', async () => {
    const repository = new MemorySourceRepository();
    await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: {
        playlistUrl: 'http://provider.test/private-user/private-pass/list',
      },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const inspection: PlaylistInspection = {
      fingerprint: 'a'.repeat(64),
      totalBytes: 100,
      entries: [
        {
          duration: -1,
          attributes: { 'group-title': 'Finland' },
          name: 'Yle TV1',
          url: 'http://provider.test/private-user/private-pass/1',
          mediaType: 'live',
          lineNumber: 2,
        },
      ],
      issues: [],
      mediaCounts: { live: 1, vod: 2, series: 0, unknown: 0 },
      skippedEntries: 2,
    };
    let inspectedUrl = '';
    const app = await buildApp({
      sourceRepository: repository,
      playlistInspector: async (url) => {
        inspectedUrl = url;
        return inspection;
      },
    });
    applications.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/00000000-0000-4000-8000-000000000001/preview-import',
    });

    expect(response.statusCode).toBe(200);
    expect(inspectedUrl).toContain('private-user');
    expect(response.body).not.toContain('private-user');
    expect(response.body).not.toContain('private-pass');
    expect(response.json().summary).toEqual(
      expect.objectContaining({ retainedLiveEntries: 1, skippedEntries: 2 }),
    );
  });

  it('stores a validated import as the latest snapshot', async () => {
    const repository = new MemorySourceRepository();
    await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const inspection: PlaylistInspection = {
      fingerprint: 'b'.repeat(64),
      totalBytes: 80,
      entries: [
        {
          duration: -1,
          attributes: { 'group-title': 'Finland' },
          name: 'Yle TV1',
          url: 'http://provider.test/synthetic/1',
          mediaType: 'live',
          lineNumber: 2,
        },
      ],
      issues: [],
      mediaCounts: { live: 1, vod: 0, series: 0, unknown: 0 },
      skippedEntries: 0,
    };
    const app = await buildApp({
      sourceRepository: repository,
      playlistInspector: async () => inspection,
    });
    applications.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/00000000-0000-4000-8000-000000000001/import',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().snapshot).toEqual(
      expect.objectContaining({ liveCount: 1, unchanged: false }),
    );
    expect(repository.latestEntries).toHaveLength(1);
  });

  it('reports a rejected snapshot without promoting it', async () => {
    const repository = new RejectingSourceRepository();
    await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const app = await buildApp({
      sourceRepository: repository,
      playlistInspector: async () => ({
        fingerprint: 'e'.repeat(64),
        totalBytes: 20,
        entries: [],
        issues: [],
        mediaCounts: { live: 0, vod: 0, series: 0, unknown: 0 },
        skippedEntries: 0,
      }),
    });
    applications.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/00000000-0000-4000-8000-000000000001/import',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain('suspicious count drop');
    expect(repository.latestEntries).toHaveLength(0);
  });
});
