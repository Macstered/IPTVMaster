import { afterEach, describe, expect, it } from 'vitest';

import {
  SnapshotRejectedError,
  type M3uEntry,
  type OutputGroupPolicy,
  type PlaylistInspection,
  type XmltvInspection,
} from '@iptvmaster/core';

import { buildApp } from './app.js';
import type {
  ChannelListFilters,
  ChannelListPage,
  ChannelSummary,
  CreateSourceInput,
  CreatedOutputProfile,
  GroupSummary,
  ResolvedOutputProfile,
  SafeSource,
  SaveGroupPolicyInput,
  SourceCredentials,
  SourceRepository,
  StoredEpgGuide,
  StoredEpgSummary,
  StoredSnapshotSummary,
  UpdateChannelInput,
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
  policies: OutputGroupPolicy[] = [];
  outputProfile: ResolvedOutputProfile | null = null;
  latestEpg: StoredEpgGuide = { channels: [], programmes: [] };
  channels: ChannelSummary[] = [];

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

  async saveEpgSnapshot(
    sourceId: string,
    inspection: XmltvInspection,
  ): Promise<StoredEpgSummary> {
    this.latestEpg = {
      channels: inspection.channels,
      programmes: inspection.programmes,
    };
    return {
      sourceId,
      fingerprint: inspection.fingerprint,
      importedAt: '2026-08-04T00:00:00.000Z',
      channelCount: inspection.channels.length,
      programmeCount: inspection.programmes.length,
      issueCount: inspection.issues.length,
      unchanged: false,
    };
  }

  async getLatestEpg(): Promise<StoredEpgGuide> {
    return this.latestEpg;
  }

  async listGroups(): Promise<GroupSummary[]> {
    const counts = new Map<string, number>();
    for (const entry of this.latestEntries) {
      const group = entry.attributes['group-title'] ?? '';
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return [...counts].map(([providerGroup, channelCount]) => ({
      providerGroup,
      channelCount,
      configured: false,
      behavior: 'permanent',
      enabled: true,
      hidePlaceholders: true,
      sourceTimeZone: 'Europe/Stockholm',
      displayTimeZone: 'Europe/Helsinki',
      numericDateOrder: 'month-day',
    }));
  }

  async saveGroupPolicy(
    sourceId: string,
    input: SaveGroupPolicyInput,
  ): Promise<GroupSummary> {
    void sourceId;
    this.policies = [
      {
        behavior: input.behavior,
        groupName: input.groupName,
        ...(input.outputGroupName
          ? { outputGroupName: input.outputGroupName }
          : {}),
        enabled: input.enabled,
        hidePlaceholders: input.hidePlaceholders,
        ...(input.placeholderPatterns
          ? { placeholderPatterns: input.placeholderPatterns }
          : {}),
        ...(input.behavior === 'event'
          ? {
              timePolicy: {
                sourceTimeZone: input.sourceTimeZone ?? 'Europe/Stockholm',
                displayTimeZone: input.displayTimeZone ?? 'Europe/Helsinki',
                numericDateOrder: input.numericDateOrder ?? 'month-day',
                referenceDate: '2026-08-04',
              },
            }
          : {}),
      },
    ];
    return {
      providerGroup: input.groupName,
      channelCount: this.latestEntries.filter(
        (entry) => entry.attributes['group-title'] === input.groupName,
      ).length,
      configured: true,
      behavior: input.behavior,
      enabled: input.enabled,
      ...(input.outputGroupName
        ? { outputGroupName: input.outputGroupName }
        : {}),
      hidePlaceholders: input.hidePlaceholders,
      sourceTimeZone: input.sourceTimeZone ?? 'Europe/Stockholm',
      displayTimeZone: input.displayTimeZone ?? 'Europe/Helsinki',
      numericDateOrder: input.numericDateOrder ?? 'month-day',
    };
  }

  async listOutputGroupPolicies(): Promise<OutputGroupPolicy[]> {
    return this.policies;
  }

  async listChannels(
    sourceId: string,
    filters: ChannelListFilters,
  ): Promise<ChannelListPage> {
    const search = filters.search?.toLocaleLowerCase() ?? '';
    const matches = this.channels.filter(
      (channel) =>
        channel.sourceId === sourceId &&
        (!filters.group || channel.providerGroup === filters.group) &&
        (!filters.status || channel.reconciliationStatus === filters.status) &&
        (!search ||
          [
            channel.providerName,
            channel.providerGroup,
            channel.customName ?? '',
            channel.customGroup ?? '',
            channel.tvgId ?? '',
          ].some((value) => value.toLocaleLowerCase().includes(search))),
    );
    return {
      channels: matches.slice(filters.offset, filters.offset + filters.limit),
      total: matches.length,
      limit: filters.limit,
      offset: filters.offset,
    };
  }

  async updateChannel(
    sourceId: string,
    channelId: string,
    input: UpdateChannelInput,
  ): Promise<ChannelSummary | null> {
    const index = this.channels.findIndex(
      (channel) => channel.sourceId === sourceId && channel.id === channelId,
    );
    const current = this.channels[index];
    if (!current) return null;
    const updated: ChannelSummary = {
      ...current,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      updatedAt: '2026-08-04T01:00:00.000Z',
    };
    for (const [key, value] of [
      ['customName', input.customName],
      ['customGroup', input.customGroup],
      ['customLogoUrl', input.customLogoUrl],
    ] as const) {
      if (value === undefined) continue;
      if (value === null) delete updated[key];
      else updated[key] = value;
    }
    this.channels[index] = updated;
    return updated;
  }

  async createOutputProfile(
    sourceId: string,
    name: string,
  ): Promise<CreatedOutputProfile> {
    const accessToken = 'synthetic_output_token_1234567890';
    this.outputProfile = {
      id: '00000000-0000-4000-8000-000000000003',
      name,
      sourceId,
    };
    return {
      id: this.outputProfile.id,
      name,
      accessToken,
      playlistPath: `/p/${accessToken}/playlist.m3u`,
      epgPath: `/p/${accessToken}/epg.xml`,
    };
  }

  async resolveOutputProfile(
    accessToken: string,
  ): Promise<ResolvedOutputProfile | null> {
    return accessToken === 'synthetic_output_token_1234567890'
      ? this.outputProfile
      : null;
  }

  async revokeOutputProfile(profileId: string): Promise<boolean> {
    if (this.outputProfile?.id !== profileId) return false;
    this.outputProfile = null;
    return true;
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
      credentials: {
        playlistUrl: 'http://provider.test/list',
        epgUrl: 'http://provider.test/guide',
      },
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

  it('lists and updates permanent channel overrides without exposing streams', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const channelId = '00000000-0000-4000-8000-000000000004';
    repository.channels = [
      {
        id: channelId,
        sourceId: source.id,
        providerName: 'Yle TV1',
        providerGroup: 'Finland',
        tvgId: 'yle1.fi',
        enabled: true,
        sortOrder: 2,
        matchLocked: false,
        matchConfidence: 1,
        reconciliationStatus: 'matched',
        lastSeenAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
    ];
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/channels?search=yle&limit=20`,
    });
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sources/${source.id}/channels/${channelId}`,
      payload: {
        enabled: false,
        customName: 'Yle One',
        customGroup: 'Finnish favourites',
        customLogoUrl: 'https://images.test/yle-one.png',
        sortOrder: 10,
      },
    });
    const unsafeLogoResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sources/${source.id}/channels/${channelId}`,
      payload: { customLogoUrl: 'ftp://images.test/yle.png' },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual(
      expect.objectContaining({ total: 1, limit: 20 }),
    );
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().channel).toEqual(
      expect.objectContaining({
        enabled: false,
        customName: 'Yle One',
        customGroup: 'Finnish favourites',
        sortOrder: 10,
      }),
    );
    expect(unsafeLogoResponse.statusCode).toBe(400);
  });

  it('publishes a token-protected M3U with event policies applied', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: {
        playlistUrl: 'http://provider.test/list',
        epgUrl: 'http://provider.test/guide',
      },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    repository.latestEntries = [
      {
        duration: -1,
        attributes: { 'tvg-name': 'Yle TV1', 'group-title': 'Finland' },
        name: 'Yle TV1',
        url: 'http://provider.test/synthetic/1',
        mediaType: 'live',
        lineNumber: 2,
      },
      {
        duration: -1,
        attributes: {
          'tvg-name': '17:00 Tennis 8/4',
          'group-title': 'MTV Urheilu Events FI',
        },
        name: '17:00 Tennis 8/4',
        url: 'http://provider.test/synthetic/2',
        mediaType: 'live',
        lineNumber: 4,
      },
      {
        duration: -1,
        attributes: {
          'tvg-name': 'Reload your playlist',
          'group-title': 'MTV Urheilu Events FI',
        },
        name: 'Reload your playlist',
        url: 'http://provider.test/synthetic/3',
        mediaType: 'live',
        lineNumber: 6,
      },
    ];
    const app = await buildApp({
      sourceRepository: repository,
      epgInspector: async () => ({
        fingerprint: 'f'.repeat(64),
        totalBytes: 200,
        channels: [{ id: 'yle1', displayName: 'Yle TV1' }],
        programmes: [
          {
            channelId: 'yle1',
            start: '2026-08-04T15:00:00.000Z',
            stop: '2026-08-04T16:00:00.000Z',
            title: 'Synthetic news',
          },
        ],
        issues: [],
        issuesTruncated: false,
      }),
    });
    applications.push(app);

    const epgImportResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${source.id}/epg/import`,
    });
    expect(epgImportResponse.statusCode).toBe(201);

    const policyResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/group-policies`,
      payload: {
        groupName: 'MTV Urheilu Events FI',
        behavior: 'event',
        enabled: true,
        outputGroupName: "Today's Finnish Sports",
        hidePlaceholders: true,
        sourceTimeZone: 'Europe/Stockholm',
        displayTimeZone: 'Europe/Helsinki',
        numericDateOrder: 'month-day',
      },
    });
    expect(policyResponse.statusCode).toBe(200);

    const profileResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/output-profiles',
      payload: { sourceId: source.id, name: 'Living room TiviMate' },
    });
    const playlistPath = profileResponse.json().profile.playlistPath as string;
    const epgPath = profileResponse.json().profile.epgPath as string;
    const playlistResponse = await app.inject({
      method: 'GET',
      url: playlistPath,
    });
    const epgResponse = await app.inject({ method: 'GET', url: epgPath });

    expect(profileResponse.statusCode).toBe(201);
    expect(playlistResponse.statusCode).toBe(200);
    expect(playlistResponse.headers['content-type']).toContain(
      'audio/x-mpegurl',
    );
    expect(playlistResponse.body).toContain('Yle TV1');
    expect(playlistResponse.body).toContain('18:00 Tennis 8/4');
    expect(playlistResponse.body).toContain(
      'group-title="Today\'s Finnish Sports"',
    );
    expect(playlistResponse.body).not.toContain('Reload your playlist');
    expect(epgResponse.statusCode).toBe(200);
    expect(epgResponse.headers['content-type']).toContain('application/xml');
    expect(epgResponse.body).toContain('<display-name>Yle TV1</display-name>');
    expect(epgResponse.body).toContain('Synthetic news');
    expect(epgResponse.body).toContain('start="20260804150000 +0000"');

    const profileId = profileResponse.json().profile.id as string;
    const revokeResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/output-profiles/${profileId}`,
    });
    const revokedPlaylistResponse = await app.inject({
      method: 'GET',
      url: playlistPath,
    });
    const revokedEpgResponse = await app.inject({
      method: 'GET',
      url: epgPath,
    });
    expect(revokeResponse.statusCode).toBe(204);
    expect(revokedPlaylistResponse.statusCode).toBe(404);
    expect(revokedEpgResponse.statusCode).toBe(404);
  });
});
