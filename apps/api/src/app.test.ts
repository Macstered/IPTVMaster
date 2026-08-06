import { afterEach, describe, expect, it } from 'vitest';

import {
  SnapshotRejectedError,
  type M3uEntry,
  type OutputGroupPolicy,
  type PlaylistInspection,
  type XmltvInspection,
  type XmltvProgramme,
} from '@iptvmaster/core';

import { appendXmltvGuide, buildApp } from './app.js';
import {
  deriveXmltvUrl,
  SnapshotActivationConflictError,
} from './source-repository.js';
import type {
  BulkUpdateChannelInput,
  BulkUpdateChannelResult,
  ActiveOutputProfile,
  ChannelListFilters,
  ChannelListPage,
  ChannelSummary,
  CustomCategory,
  CreateSourceInput,
  CreatedOutputProfile,
  GroupSummary,
  OutputGroupSummary,
  PermanentGroupSummary,
  ResolvedOutputProfile,
  ReconciliationCandidate,
  ReconciliationReview,
  SafeSource,
  SaveGroupPolicyInput,
  SnapshotHistoryItem,
  SourceActivityEvent,
  SourceHistory,
  SourceCredentials,
  SourceRepository,
  StoredEpgGuide,
  StoredEpgSummary,
  StoredSnapshotSummary,
  UpdateChannelInput,
  UpdatePermanentGroupInput,
  UpdateSourceInput,
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
  readonly latestEntriesBySource = new Map<string, M3uEntry[]>();
  policies: OutputGroupPolicy[] = [];
  outputProfile: ResolvedOutputProfile | null = null;
  latestEpg: StoredEpgGuide = { channels: [], programmes: [] };
  readonly latestEpgBySource = new Map<string, StoredEpgGuide>();
  channels: ChannelSummary[] = [];
  reviewCandidates: ReconciliationCandidate[] = [];
  snapshots: SnapshotHistoryItem[] = [];
  activity: SourceActivityEvent[] = [];
  snapshotEntries = new Map<string, M3uEntry[]>();
  epgMappings = new Map<string, string>();
  readonly customCategories = new Map<string, Set<string>>();
  readonly outputGroupOrders = new Map<string, string[]>();
  readonly outputCategoryOrders = new Map<string, string[]>();

  async createSource(input: CreateSourceInput): Promise<SafeSource> {
    this.inputs.push(input);
    const source: SafeSource = {
      id: `00000000-0000-4000-8000-${String(this.inputs.length).padStart(12, '0')}`,
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

  async updateSource(
    sourceId: string,
    input: UpdateSourceInput,
  ): Promise<SafeSource | null> {
    const index = this.sources.findIndex((source) => source.id === sourceId);
    const current = this.sources[index];
    const currentInput = this.inputs[index];
    if (!current || !currentInput) return null;
    const derivedEpgUrl = input.deriveEpgUrl
      ? deriveXmltvUrl(
          input.playlistUrl ?? currentInput.credentials.playlistUrl,
        )
      : undefined;
    if (input.deriveEpgUrl && !derivedEpgUrl) {
      throw new Error('Could not derive XMLTV URL');
    }
    const credentials: SourceCredentials = {
      playlistUrl: input.playlistUrl ?? currentInput.credentials.playlistUrl,
      ...(input.clearEpgUrl
        ? {}
        : input.epgUrl
          ? { epgUrl: input.epgUrl }
          : derivedEpgUrl
            ? { epgUrl: derivedEpgUrl }
            : currentInput.credentials.epgUrl
              ? { epgUrl: currentInput.credentials.epgUrl }
              : {}),
    };
    this.inputs[index] = { ...currentInput, credentials };
    const updated: SafeSource = {
      ...current,
      name: input.name,
      sourceTimezone: input.sourceTimezone,
      displayTimezone: input.displayTimezone,
      hasEpgUrl: credentials.epgUrl !== undefined,
      updatedAt: '2026-08-05T00:00:00.000Z',
    };
    this.sources[index] = updated;
    return updated;
  }

  async deleteSource(sourceId: string) {
    const index = this.sources.findIndex((source) => source.id === sourceId);
    if (index < 0) return null;
    const revokedOutputProfiles = this.outputProfile?.sourceIds.includes(
      sourceId,
    )
      ? 1
      : 0;
    if (revokedOutputProfiles > 0) this.outputProfile = null;
    this.sources.splice(index, 1);
    this.inputs.splice(index, 1);
    this.latestEntriesBySource.delete(sourceId);
    this.latestEpgBySource.delete(sourceId);
    return { revokedOutputProfiles };
  }

  async listSources(): Promise<SafeSource[]> {
    return this.sources;
  }

  async getSourceCredentials(
    sourceId: string,
  ): Promise<SourceCredentials | null> {
    const index = this.sources.findIndex((source) => source.id === sourceId);
    return index < 0 ? null : (this.inputs[index]?.credentials ?? null);
  }

  async savePlaylistSnapshot(
    sourceId: string,
    inspection: PlaylistInspection,
  ): Promise<StoredSnapshotSummary> {
    const existing = this.snapshots.find(
      (snapshot) => snapshot.fingerprint === inspection.fingerprint,
    );
    if (existing) {
      const wasCurrent = existing.isCurrent;
      if (!wasCurrent) await this.activateSnapshot(sourceId, existing.id);
      return { ...existing, unchanged: wasCurrent };
    }
    this.latestEntries = inspection.entries;
    this.latestEntriesBySource.set(sourceId, inspection.entries);
    this.snapshots = this.snapshots.map((snapshot) => ({
      ...snapshot,
      isCurrent: false,
    }));
    const suffix = String(this.snapshots.length + 2).padStart(12, '0');
    const snapshot: SnapshotHistoryItem = {
      id: `00000000-0000-4000-8000-${suffix}`,
      sourceId,
      fingerprint: inspection.fingerprint,
      importedAt: '2026-08-04T00:00:00.000Z',
      liveCount: inspection.entries.length,
      skippedEntries: inspection.skippedEntries,
      issueCount: inspection.issues.length,
      isCurrent: true,
    };
    this.snapshots.unshift(snapshot);
    this.snapshotEntries.set(snapshot.id, inspection.entries);
    this.activity.unshift({
      id: `10000000-0000-4000-8000-${suffix}`,
      kind: 'playlist-sync',
      occurredAt: snapshot.importedAt,
      title: 'Playlist refresh succeeded',
      detail: `${snapshot.liveCount} live entries accepted.`,
      status: 'succeeded',
    });
    return { ...snapshot, unchanged: false };
  }

  async listSourceHistory(
    sourceId: string,
    limit: number,
  ): Promise<SourceHistory> {
    return {
      snapshots: this.snapshots
        .filter((snapshot) => snapshot.sourceId === sourceId)
        .slice(0, limit),
      activity: this.activity.slice(0, limit),
    };
  }

  async activateSnapshot(
    sourceId: string,
    snapshotId: string,
  ): Promise<SnapshotHistoryItem | null> {
    const target = this.snapshots.find(
      (snapshot) =>
        snapshot.sourceId === sourceId && snapshot.id === snapshotId,
    );
    if (!target) return null;
    if (target.isCurrent) {
      throw new SnapshotActivationConflictError(
        'The selected snapshot is already current',
      );
    }
    this.snapshots = this.snapshots.map((snapshot) => ({
      ...snapshot,
      isCurrent: snapshot.id === snapshotId,
    }));
    this.latestEntries = this.snapshotEntries.get(snapshotId) ?? [];
    const activated = this.snapshots.find(
      (snapshot) => snapshot.id === snapshotId,
    );
    if (!activated) return null;
    this.activity.unshift({
      id: `20000000-0000-4000-8000-${String(this.activity.length + 1).padStart(12, '0')}`,
      kind: 'snapshot-activate',
      occurredAt: '2026-08-04T02:00:00.000Z',
      title: 'Snapshot restored',
      detail: `${activated.liveCount} live entries restored.`,
      status: 'succeeded',
    });
    return activated;
  }

  async getLatestPlaylistEntries(sourceId: string): Promise<M3uEntry[]> {
    const entries =
      this.latestEntriesBySource.get(sourceId) ?? this.latestEntries;
    const policiesByGroup = new Map(
      this.policies.map((policy) => [policy.groupName, policy]),
    );
    const ranks = new Map(
      (this.outputCategoryOrders.get(sourceId) ?? []).map((group, index) => [
        group,
        index,
      ]),
    );
    return entries
      .map((entry, index) => {
        const providerGroup = entry.attributes['group-title'] ?? '';
        const policy = policiesByGroup.get(providerGroup);
        const channel = this.channels.find(
          (candidate) =>
            candidate.sourceId === sourceId &&
            candidate.providerGroup === providerGroup &&
            candidate.providerName === entry.name,
        );
        const outputGroup =
          channel?.customGroup ?? policy?.outputGroupName ?? providerGroup;
        return { entry, index, outputGroup };
      })
      .sort(
        (left, right) =>
          (ranks.get(left.outputGroup) ?? Number.MAX_SAFE_INTEGER) -
            (ranks.get(right.outputGroup) ?? Number.MAX_SAFE_INTEGER) ||
          left.index - right.index,
      )
      .map(({ entry }) => entry);
  }

  async saveEpgSnapshot(
    sourceId: string,
    inspection: XmltvInspection,
  ): Promise<StoredEpgSummary> {
    this.latestEpg = {
      channels: inspection.channels,
      programmes: inspection.programmes,
    };
    this.latestEpgBySource.set(sourceId, this.latestEpg);
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

  async getLatestEpg(sourceId: string): Promise<StoredEpgGuide> {
    return this.latestEpgBySource.get(sourceId) ?? this.latestEpg;
  }

  async listGroups(sourceId: string): Promise<GroupSummary[]> {
    const counts = new Map<string, number>();
    const entries =
      this.latestEntriesBySource.get(sourceId) ?? this.latestEntries;
    for (const entry of entries) {
      const group = entry.attributes['group-title'] ?? '';
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    const policiesByGroup = new Map(
      this.policies.map((policy) => [policy.groupName, policy]),
    );
    const ranks = new Map(
      (this.outputGroupOrders.get(sourceId) ?? []).map((group, index) => [
        group,
        index,
      ]),
    );
    return [...counts]
      .map(([providerGroup, channelCount], index) => {
        const policy = policiesByGroup.get(providerGroup);
        return {
          providerGroup,
          channelCount,
          sortOrder: ranks.get(providerGroup) ?? index,
          configured: policy !== undefined,
          behavior: policy?.behavior ?? 'permanent',
          enabled: policy?.enabled ?? true,
          ...(policy?.outputGroupName
            ? { outputGroupName: policy.outputGroupName }
            : {}),
          hidePlaceholders: policy?.hidePlaceholders ?? true,
          sourceTimeZone: 'Europe/Stockholm',
          displayTimeZone: 'Europe/Helsinki',
          numericDateOrder: 'month-day' as const,
        };
      })
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.providerGroup.localeCompare(right.providerGroup),
      );
  }

  async listOutputGroups(sourceId: string): Promise<OutputGroupSummary[]> {
    const entries =
      this.latestEntriesBySource.get(sourceId) ?? this.latestEntries;
    const policiesByGroup = new Map(
      this.policies.map((policy) => [policy.groupName, policy]),
    );
    const groups = new Map<
      string,
      {
        entryCount: number;
        visibleEntryCount: number;
        hasEvent: boolean;
        hasPermanent: boolean;
      }
    >();
    const add = (name: string) => {
      const current = groups.get(name) ?? {
        entryCount: 0,
        visibleEntryCount: 0,
        hasEvent: false,
        hasPermanent: false,
      };
      groups.set(name, current);
      return current;
    };
    for (const entry of entries) {
      const providerGroup = entry.attributes['group-title'] ?? '';
      const policy = policiesByGroup.get(providerGroup);
      const channel = this.channels.find(
        (candidate) =>
          candidate.sourceId === sourceId &&
          candidate.providerGroup === providerGroup &&
          candidate.providerName === entry.name,
      );
      const name =
        channel?.customGroup ?? policy?.outputGroupName ?? providerGroup;
      const current = add(name);
      current.entryCount += 1;
      if (policy?.behavior === 'event') {
        current.hasEvent = true;
        if (policy.enabled) current.visibleEntryCount += 1;
      } else {
        current.hasPermanent = true;
        if (channel?.enabled ?? true) current.visibleEntryCount += 1;
      }
    }
    for (const name of this.customCategories.get(sourceId) ?? []) add(name);
    const ranks = new Map(
      (this.outputCategoryOrders.get(sourceId) ?? []).map((name, index) => [
        name,
        index,
      ]),
    );
    return [...groups.entries()]
      .map(([name, group], index) => ({
        name,
        entryCount: group.entryCount,
        visibleEntryCount: group.visibleEntryCount,
        behavior:
          group.hasEvent && group.hasPermanent
            ? ('mixed' as const)
            : group.hasEvent
              ? ('event' as const)
              : ('permanent' as const),
        sortOrder: ranks.get(name) ?? index,
      }))
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name),
      );
  }

  async bulkUpdateGroupPolicies(
    sourceId: string,
    groupNames: string[],
    update: {
      behavior?: 'permanent' | 'event';
      enabled?: boolean;
      outputGroupName?: string | null;
    },
  ) {
    const entries =
      this.latestEntriesBySource.get(sourceId) ?? this.latestEntries;
    const knownGroups = new Set(
      entries.map((entry) => entry.attributes['group-title'] ?? ''),
    );
    const byName = new Map(
      this.policies.map((policy) => [policy.groupName, policy]),
    );
    let updatedCount = 0;
    for (const name of groupNames) {
      if (!knownGroups.has(name)) continue;
      updatedCount += 1;
      const existing = byName.get(name);
      if (existing) {
        if (update.behavior !== undefined) existing.behavior = update.behavior;
        if (update.enabled !== undefined) existing.enabled = update.enabled;
        if (update.outputGroupName !== undefined) {
          if (update.outputGroupName === null) {
            delete existing.outputGroupName;
          } else {
            existing.outputGroupName = update.outputGroupName;
          }
        }
      } else {
        byName.set(name, {
          groupName: name,
          behavior: update.behavior ?? 'permanent',
          enabled: update.enabled ?? true,
          hidePlaceholders: true,
          ...(update.outputGroupName
            ? { outputGroupName: update.outputGroupName }
            : {}),
        });
      }
    }
    this.policies = [...byName.values()];
    return { updatedCount };
  }

  async saveGroupPolicy(
    sourceId: string,
    input: SaveGroupPolicyInput,
  ): Promise<GroupSummary> {
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
      channelCount: (
        this.latestEntriesBySource.get(sourceId) ?? this.latestEntries
      ).filter((entry) => entry.attributes['group-title'] === input.groupName)
        .length,
      sortOrder: Math.max(
        this.outputGroupOrders.get(sourceId)?.indexOf(input.groupName) ?? 0,
        0,
      ),
      configured: true,
      behavior: input.behavior,
      enabled: input.enabled,
      ...(input.outputGroupName
        ? { outputGroupName: input.outputGroupName }
        : {}),
      hidePlaceholders: input.hidePlaceholders,
      ...(input.placeholderPatterns
        ? { placeholderPatterns: input.placeholderPatterns }
        : {}),
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
        (!filters.outputGroup ||
          (channel.customGroup ?? channel.providerGroup) ===
            filters.outputGroup) &&
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
      channels: matches
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.providerGroup.localeCompare(right.providerGroup) ||
            left.providerName.localeCompare(right.providerName),
        )
        .slice(filters.offset, filters.offset + filters.limit),
      total: matches.length,
      limit: filters.limit,
      offset: filters.offset,
    };
  }

  async listPermanentGroups(
    sourceId: string,
  ): Promise<PermanentGroupSummary[]> {
    const byGroup = new Map<string, ChannelSummary[]>();
    for (const channel of this.channels) {
      if (channel.sourceId !== sourceId) continue;
      const current = byGroup.get(channel.providerGroup) ?? [];
      current.push(channel);
      byGroup.set(channel.providerGroup, current);
    }
    return [...byGroup.entries()]
      .sort(
        ([leftName, leftChannels], [rightName, rightChannels]) =>
          Math.min(...leftChannels.map((channel) => channel.sortOrder)) -
            Math.min(...rightChannels.map((channel) => channel.sortOrder)) ||
          leftName.localeCompare(rightName),
      )
      .map(([providerGroup, channels]) => {
        const customGroups = new Set(
          channels
            .map((channel) => channel.customGroup)
            .filter((value): value is string => value !== undefined),
        );
        const hasProviderGroup = channels.some(
          (channel) => channel.customGroup === undefined,
        );
        const outputGroupStatus =
          customGroups.size === 0
            ? 'provider'
            : customGroups.size === 1 && !hasProviderGroup
              ? 'custom'
              : 'mixed';
        const enabledCount = channels.filter(
          (channel) => channel.enabled,
        ).length;
        return {
          providerGroup,
          channelCount: channels.length,
          enabledCount,
          hiddenCount: channels.length - enabledCount,
          firstSortOrder: Math.min(
            ...channels.map((channel) => channel.sortOrder),
          ),
          outputGroupStatus,
          ...(outputGroupStatus === 'custom'
            ? { outputGroupName: [...customGroups][0] }
            : {}),
        };
      });
  }

  async updatePermanentGroup(
    sourceId: string,
    providerGroup: string,
    input: UpdatePermanentGroupInput,
  ): Promise<BulkUpdateChannelResult> {
    const matching = this.channels
      .filter(
        (channel) =>
          channel.sourceId === sourceId &&
          channel.providerGroup === providerGroup,
      )
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.providerName.localeCompare(right.providerName) ||
          left.id.localeCompare(right.id),
      );
    const offsets = new Map(
      matching.map((channel, index) => [channel.id, index]),
    );
    this.channels = this.channels.map((channel) => {
      if (!offsets.has(channel.id)) return channel;
      const updated = {
        ...channel,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.startSortOrder === undefined
          ? {}
          : {
              sortOrder: input.startSortOrder + (offsets.get(channel.id) ?? 0),
            }),
      };
      if (input.customGroup !== undefined) {
        if (input.customGroup === null) delete updated.customGroup;
        else updated.customGroup = input.customGroup;
      }
      return updated;
    });
    return { updatedCount: matching.length };
  }

  async reorderPermanentGroups(
    sourceId: string,
    providerGroups: string[],
  ): Promise<void> {
    const groups = new Set(
      this.channels
        .filter((channel) => channel.sourceId === sourceId)
        .map((channel) => channel.providerGroup),
    );
    if (
      groups.size !== providerGroups.length ||
      providerGroups.some((group) => !groups.has(group))
    ) {
      throw new Error('Permanent group order no longer matches this source');
    }
    const rank = new Map(providerGroups.map((group, index) => [group, index]));
    const ordered = this.channels
      .filter((channel) => channel.sourceId === sourceId)
      .sort(
        (left, right) =>
          (rank.get(left.providerGroup) ?? 0) -
            (rank.get(right.providerGroup) ?? 0) ||
          left.sortOrder - right.sortOrder,
      );
    const sortOrders = new Map(
      ordered.map((channel, index) => [channel.id, index]),
    );
    this.channels = this.channels.map((channel) =>
      sortOrders.has(channel.id)
        ? {
            ...channel,
            sortOrder: sortOrders.get(channel.id) ?? channel.sortOrder,
          }
        : channel,
    );
  }

  async reorderOutputGroups(
    sourceId: string,
    outputGroups: string[],
  ): Promise<void> {
    const groups = new Set(
      (await this.listOutputGroups(sourceId)).map((group) => group.name),
    );
    if (
      groups.size !== outputGroups.length ||
      outputGroups.some((group) => !groups.has(group))
    ) {
      throw new Error('Output group order no longer matches this source');
    }
    this.outputCategoryOrders.set(sourceId, [...outputGroups]);
  }

  async reorderChannels(
    sourceId: string,
    providerGroup: string,
    channelIds: string[],
  ): Promise<void> {
    const matching = this.channels
      .filter(
        (channel) =>
          channel.sourceId === sourceId &&
          channel.providerGroup === providerGroup,
      )
      .sort((left, right) => left.sortOrder - right.sortOrder);
    if (
      matching.length !== channelIds.length ||
      matching.some((channel) => !channelIds.includes(channel.id))
    ) {
      throw new Error('Channel order no longer matches this provider group');
    }
    const slots = matching.map((channel) => channel.sortOrder);
    const sortOrders = new Map(
      channelIds.map((id, index) => [id, slots[index]]),
    );
    this.channels = this.channels.map((channel) =>
      sortOrders.has(channel.id)
        ? {
            ...channel,
            sortOrder: sortOrders.get(channel.id) ?? channel.sortOrder,
          }
        : channel,
    );
  }

  async reorderOutputGroupChannels(
    sourceId: string,
    outputGroup: string,
    channelIds: string[],
  ): Promise<void> {
    const matching = this.channels
      .filter(
        (channel) =>
          channel.sourceId === sourceId &&
          (channel.customGroup ?? channel.providerGroup) === outputGroup,
      )
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.providerGroup.localeCompare(right.providerGroup) ||
          left.providerName.localeCompare(right.providerName),
      );
    if (
      matching.length !== channelIds.length ||
      matching.some((channel) => !channelIds.includes(channel.id))
    ) {
      throw new Error('Output group channels no longer match this source');
    }
    const firstSortOrder = Math.min(
      ...matching.map((channel) => channel.sortOrder),
    );
    const sortOrders = new Map(
      channelIds.map((id, index) => [id, firstSortOrder + index]),
    );
    this.channels = this.channels.map((channel) =>
      sortOrders.has(channel.id)
        ? {
            ...channel,
            sortOrder: sortOrders.get(channel.id) ?? channel.sortOrder,
          }
        : channel,
    );
  }

  async listCustomCategories(sourceId: string): Promise<CustomCategory[]> {
    const names = new Set(this.customCategories.get(sourceId) ?? []);
    for (const channel of this.channels) {
      if (channel.sourceId === sourceId && channel.customGroup) {
        names.add(channel.customGroup);
      }
    }
    return [...names]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({
        name,
        channelCount: this.channels.filter(
          (channel) =>
            channel.sourceId === sourceId && channel.customGroup === name,
        ).length,
      }));
  }

  async createCustomCategory(
    sourceId: string,
    name: string,
  ): Promise<CustomCategory> {
    if (!this.sources.some((source) => source.id === sourceId)) {
      throw new Error('Source not found while creating category');
    }
    const categories = this.customCategories.get(sourceId) ?? new Set<string>();
    categories.add(name);
    this.customCategories.set(sourceId, categories);
    return {
      name,
      channelCount: this.channels.filter(
        (channel) =>
          channel.sourceId === sourceId && channel.customGroup === name,
      ).length,
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
    if (input.epgExcluded !== undefined) {
      if (input.epgExcluded) {
        updated.epgExcluded = true;
        this.epgMappings.delete(updated.id);
      } else {
        delete updated.epgExcluded;
      }
    }
    this.channels[index] = updated;
    return updated;
  }

  async bulkUpdateChannels(
    sourceId: string,
    channelIds: string[],
    input: BulkUpdateChannelInput,
  ): Promise<BulkUpdateChannelResult> {
    const selected = new Set(channelIds);
    let updatedCount = 0;
    this.channels = this.channels.map((channel) => {
      if (channel.sourceId !== sourceId || !selected.has(channel.id)) {
        return channel;
      }
      updatedCount += 1;
      const updated = { ...channel };
      if (input.enabled !== undefined) updated.enabled = input.enabled;
      for (const [key, value] of [
        ['customGroup', input.customGroup],
        ['customLogoUrl', input.customLogoUrl],
      ] as const) {
        if (value === undefined) continue;
        if (value === null) delete updated[key];
        else updated[key] = value;
      }
      if (input.epgExcluded !== undefined) {
        if (input.epgExcluded) {
          updated.epgExcluded = true;
          this.epgMappings.delete(updated.id);
        } else {
          delete updated.epgExcluded;
        }
      }
      return updated;
    });
    return { updatedCount };
  }

  async getSystemStatus() {
    return {
      sources: this.sources.map((source) => {
        const channels = this.channels.filter(
          (channel) => channel.sourceId === source.id,
        );
        return {
          sourceId: source.id,
          name: source.name,
          enabled: source.enabled,
          channelCount: channels.length,
          visibleChannelCount: channels.filter((channel) => channel.enabled)
            .length,
          groupCount: new Set(
            channels.map(
              (channel) => channel.customGroup ?? channel.providerGroup,
            ),
          ).size,
          reviewPending: channels.filter((channel) =>
            ['missing', 'ambiguous'].includes(channel.reconciliationStatus),
          ).length,
          epgMappable: channels.filter(
            (channel) => channel.enabled && !channel.epgExcluded,
          ).length,
          epgMapped: channels.filter((channel) =>
            this.epgMappings.has(channel.id),
          ).length,
          epgExcluded: channels.filter((channel) => channel.epgExcluded).length,
        };
      }),
      outputProfileCount: this.outputProfile ? 1 : 0,
    };
  }

  async getReconciliationReview(
    sourceId: string,
    search: string | undefined,
    limit: number,
  ): Promise<ReconciliationReview> {
    const normalizedSearch = search?.toLocaleLowerCase() ?? '';
    const unresolved = this.channels.filter(
      (channel) =>
        channel.sourceId === sourceId &&
        ['ambiguous', 'missing'].includes(channel.reconciliationStatus) &&
        (!normalizedSearch ||
          [
            channel.providerName,
            channel.providerGroup,
            channel.tvgId ?? '',
          ].some((value) =>
            value.toLocaleLowerCase().includes(normalizedSearch),
          )),
    );
    const candidates = this.reviewCandidates;
    return {
      unresolvedChannels: unresolved.slice(0, limit),
      candidates: candidates.slice(0, limit),
      ambiguousCount: this.channels.filter(
        (channel) => channel.reconciliationStatus === 'ambiguous',
      ).length,
      missingCount: this.channels.filter(
        (channel) => channel.reconciliationStatus === 'missing',
      ).length,
      newCount: this.channels.filter(
        (channel) => channel.reconciliationStatus === 'new',
      ).length,
      candidateTotal: candidates.length,
      truncated: unresolved.length > limit || candidates.length > limit,
    };
  }

  async resolveChannelMatch(
    sourceId: string,
    channelId: string,
    upstreamItemId: string,
  ): Promise<ChannelSummary | null> {
    const candidate = this.reviewCandidates.find(
      (value) => value.upstreamItemId === upstreamItemId,
    );
    const target = this.channels.find(
      (channel) => channel.sourceId === sourceId && channel.id === channelId,
    );
    if (!candidate || !target) return null;
    this.channels = this.channels.filter(
      (channel) =>
        channel.id === target.id || channel.id !== candidate.linkedChannelId,
    );
    const updated: ChannelSummary = {
      ...target,
      providerName: candidate.providerName,
      providerGroup: candidate.providerGroup,
      ...(candidate.tvgId ? { tvgId: candidate.tvgId } : {}),
      matchLocked: true,
      matchConfidence: 1,
      reconciliationStatus: 'matched',
    };
    this.channels = this.channels.map((channel) =>
      channel.id === target.id ? updated : channel,
    );
    this.reviewCandidates = this.reviewCandidates.filter(
      (value) => value.upstreamItemId !== upstreamItemId,
    );
    return updated;
  }

  async unlockChannelMatch(
    sourceId: string,
    channelId: string,
  ): Promise<ChannelSummary | null> {
    const channel = this.channels.find(
      (value) => value.sourceId === sourceId && value.id === channelId,
    );
    if (!channel) return null;
    channel.matchLocked = false;
    return channel;
  }

  async getEpgMappingReview(
    sourceId: string,
    search: string | undefined,
    limit: number,
    view: 'mappable' | 'excluded' = 'mappable',
  ) {
    const normalizedSearch = search?.toLocaleLowerCase() ?? '';
    const excludedChannels = this.channels.filter(
      (channel) => channel.sourceId === sourceId && channel.epgExcluded,
    );
    if (view === 'excluded') {
      const excludedMappings = excludedChannels.map((channel) => ({
        channelId: channel.id,
        channelName: channel.customName ?? channel.providerName,
        providerGroup: channel.providerGroup,
        ...(channel.tvgId ? { tvgId: channel.tvgId } : {}),
        status: 'excluded' as const,
        manuallyLocked: false,
        candidateIds: [],
      }));
      return {
        mappings: excludedMappings.slice(0, limit),
        matchedCount: 0,
        missingCount: 0,
        ambiguousCount: 0,
        manualCount: 0,
        excludedCount: excludedChannels.length,
        total: 0,
        truncated: excludedMappings.length > limit,
      };
    }
    const mappings = this.channels
      .filter(
        (channel) =>
          channel.sourceId === sourceId &&
          !channel.epgExcluded &&
          (!normalizedSearch ||
            [channel.providerName, channel.providerGroup, channel.tvgId ?? '']
              .join(' ')
              .toLocaleLowerCase()
              .includes(normalizedSearch)),
      )
      .map((channel) => {
        const manualId = this.epgMappings.get(channel.id);
        const candidates = this.latestEpg.channels.filter(
          (guide) =>
            (manualId && guide.id === manualId) ||
            (!manualId &&
              ((channel.tvgId && guide.id === channel.tvgId) ||
                guide.displayName.toLocaleLowerCase() ===
                  channel.providerName
                    .replace(/\s+(?:hd|fhd|uhd|4k)$/iu, '')
                    .toLocaleLowerCase())),
        );
        const selected = candidates.length === 1 ? candidates[0] : undefined;
        return {
          channelId: channel.id,
          channelName: channel.customName ?? channel.providerName,
          providerGroup: channel.providerGroup,
          ...(channel.tvgId ? { tvgId: channel.tvgId } : {}),
          status: selected
            ? ('matched' as const)
            : candidates.length > 1
              ? ('ambiguous' as const)
              : ('missing' as const),
          manuallyLocked: manualId !== undefined,
          ...(selected
            ? {
                epgChannelId: selected.id,
                epgDisplayName: selected.displayName,
                confidence: manualId || channel.tvgId ? 1 : 0.85,
              }
            : manualId
              ? { epgChannelId: manualId }
              : {}),
          candidateIds: candidates.map((candidate) => candidate.id),
          ...(candidates.length > 1
            ? {
                candidates: candidates.map((candidate) => ({
                  id: candidate.id,
                  displayName: candidate.displayName,
                })),
              }
            : {}),
        };
      });
    return {
      mappings: mappings.slice(0, limit),
      matchedCount: mappings.filter((mapping) => mapping.status === 'matched')
        .length,
      missingCount: mappings.filter((mapping) => mapping.status === 'missing')
        .length,
      ambiguousCount: mappings.filter(
        (mapping) => mapping.status === 'ambiguous',
      ).length,
      manualCount: mappings.filter((mapping) => mapping.manuallyLocked).length,
      excludedCount: excludedChannels.length,
      total: mappings.length,
      truncated: mappings.length > limit,
    };
  }

  async searchEpgChannels(
    _sourceId: string,
    search: string | undefined,
    limit: number,
  ) {
    const normalizedSearch = search?.toLocaleLowerCase() ?? '';
    const channels = this.latestEpg.channels.filter(
      (channel) =>
        !normalizedSearch ||
        [channel.id, channel.displayName].some((value) =>
          value.toLocaleLowerCase().includes(normalizedSearch),
        ),
    );
    return {
      channels: channels.slice(0, limit),
      total: channels.length,
      truncated: channels.length > limit,
    };
  }

  async saveManualEpgMapping(
    sourceId: string,
    channelId: string,
    epgChannelId: string,
  ): Promise<boolean> {
    if (
      !this.channels.some(
        (channel) => channel.sourceId === sourceId && channel.id === channelId,
      ) ||
      !this.latestEpg.channels.some((channel) => channel.id === epgChannelId)
    ) {
      return false;
    }
    this.epgMappings.set(channelId, epgChannelId);
    return true;
  }

  async unlockEpgMapping(
    sourceId: string,
    channelId: string,
  ): Promise<boolean> {
    if (
      !this.channels.some(
        (channel) => channel.sourceId === sourceId && channel.id === channelId,
      )
    ) {
      return false;
    }
    return this.epgMappings.delete(channelId);
  }

  async createOutputProfile(
    sourceIds: string[],
    name: string,
  ): Promise<CreatedOutputProfile> {
    const accessToken = 'synthetic_output_token_1234567890';
    this.outputProfile = {
      id: '00000000-0000-4000-8000-000000000003',
      name,
      sourceIds,
    };
    return {
      id: this.outputProfile.id,
      name,
      accessToken,
      playlistPath: `/m/${accessToken}`,
      epgPath: `/e/${accessToken}`,
    };
  }

  async listOutputProfiles(): Promise<ActiveOutputProfile[]> {
    return this.outputProfile
      ? [
          {
            ...this.outputProfile,
            createdAt: '2026-08-05T00:00:00.000Z',
            recoverable: true,
            accessToken: 'synthetic_output_token_1234567890',
          },
        ]
      : [];
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
  it('appends a large XMLTV guide without spreading it onto the call stack', () => {
    const programme: XmltvProgramme = {
      channelId: 'guide-1',
      start: '2026-08-05T12:00:00.000Z',
      title: 'Synthetic programme',
    };
    const guide = {
      channels: [{ id: 'guide-1', displayName: 'Guide one' }],
      programmes: Array.from({ length: 150_000 }, () => programme),
    };
    const output = { channels: [], programmes: [] } as {
      channels: typeof guide.channels;
      programmes: XmltvProgramme[];
    };

    appendXmltvGuide(output, guide);

    expect(output.channels).toHaveLength(1);
    expect(output.programmes).toHaveLength(150_000);
  });

  it('reports health', async () => {
    const app = await buildApp();
    applications.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'iptvmaster-api',
      version: 'development',
      revision: 'unknown',
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

  it('derives and securely saves an XMLTV URL for an existing provider', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: syntheticProviderUrl('/get.php') },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}`,
      payload: {
        name: 'Home provider',
        deriveEpgUrl: true,
        sourceTimezone: 'Europe/Stockholm',
        displayTimezone: 'Europe/Helsinki',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('provider.test');
    expect(response.body).not.toContain('synthetic-secret');
    expect(response.json().source).toEqual(
      expect.objectContaining({ hasEpgUrl: true }),
    );
    expect(repository.inputs[0]?.credentials.epgUrl).toContain('/xmltv.php');
    expect(repository.inputs[0]?.credentials.epgUrl).toContain(
      'password=synthetic-secret',
    );
  });

  it('removes M3U-only options when deriving an XMLTV URL', () => {
    const derived = deriveXmltvUrl(
      'http://provider.test/get.php?username=synthetic-user&password=synthetic-secret&type=m3u_plus&output?ts',
    );

    expect(derived).not.toBeNull();
    const url = new URL(derived!);
    expect(url.pathname).toBe('/xmltv.php');
    expect([...url.searchParams.entries()]).toEqual([
      ['username', 'synthetic-user'],
      ['password', 'synthetic-secret'],
    ]);
  });

  it('removes a provider and revokes every output that includes it', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: syntheticProviderUrl('/get.php') },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    await repository.createOutputProfile([source.id], 'TiviMate');
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sources/${source.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revokedOutputProfiles: 1 });
    await expect(repository.listSources()).resolves.toEqual([]);
    await expect(
      repository.resolveOutputProfile('synthetic_output_token_1234567890'),
    ).resolves.toBeNull();
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

  it('lists retained snapshots and safely restores an older version', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const inspection = (
      fingerprint: string,
      name: string,
    ): PlaylistInspection => ({
      fingerprint: fingerprint.repeat(64),
      totalBytes: 80,
      entries: [
        {
          duration: -1,
          attributes: { 'group-title': 'Finland' },
          name,
          url: `http://provider.test/synthetic/${fingerprint}`,
          mediaType: 'live',
          lineNumber: 2,
        },
      ],
      issues: [],
      mediaCounts: { live: 1, vod: 0, series: 0, unknown: 0 },
      skippedEntries: 0,
    });
    const older = await repository.savePlaylistSnapshot(
      source.id,
      inspection('a', 'Yle TV1'),
    );
    const newer = await repository.savePlaylistSnapshot(
      source.id,
      inspection('b', 'Yle TV1 HD'),
    );
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const historyResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/history?limit=10`,
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: older.id, isCurrent: false }),
        expect.objectContaining({ id: newer.id, isCurrent: true }),
      ]),
    );

    const activateResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${source.id}/snapshots/${older.id}/activate`,
    });
    expect(activateResponse.statusCode).toBe(200);
    expect(activateResponse.json().snapshot).toEqual(
      expect.objectContaining({ id: older.id, isCurrent: true }),
    );
    expect(repository.latestEntries[0]?.name).toBe('Yle TV1');

    const updatedHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/history?limit=10`,
    });
    expect(updatedHistory.json().activity[0]).toEqual(
      expect.objectContaining({ kind: 'snapshot-activate' }),
    );
    const conflictResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${source.id}/snapshots/${older.id}/activate`,
    });
    expect(conflictResponse.statusCode).toBe(409);
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

  it('manages permanent groups without applying event rules to them', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    repository.channels = [
      {
        id: '00000000-0000-4000-8000-000000000030',
        sourceId: source.id,
        providerName: 'Yle TV1',
        providerGroup: 'Finland',
        enabled: true,
        sortOrder: 12,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000031',
        sourceId: source.id,
        providerName: 'Yle TV2',
        providerGroup: 'Finland',
        enabled: false,
        sortOrder: 18,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000032',
        sourceId: source.id,
        providerName: 'BBC World News',
        providerGroup: 'News',
        enabled: true,
        sortOrder: 24,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
    ];
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/permanent-groups`,
    });
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sources/${source.id}/permanent-groups`,
      payload: {
        groupName: 'Finland',
        update: {
          enabled: false,
          customGroup: 'Finnish favourites',
          startSortOrder: 100,
        },
      },
    });
    const updatedListResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/permanent-groups`,
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerGroup: 'Finland',
          channelCount: 2,
          enabledCount: 1,
          hiddenCount: 1,
          firstSortOrder: 12,
          outputGroupStatus: 'provider',
        }),
      ]),
    );
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toEqual({ updatedCount: 2 });
    expect(updatedListResponse.json().groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerGroup: 'Finland',
          enabledCount: 0,
          hiddenCount: 2,
          firstSortOrder: 100,
          outputGroupStatus: 'custom',
          outputGroupName: 'Finnish favourites',
        }),
      ]),
    );
    expect(repository.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerGroup: 'Finland',
          enabled: false,
          customGroup: 'Finnish favourites',
          sortOrder: 100,
        }),
        expect.objectContaining({
          providerGroup: 'Finland',
          enabled: false,
          customGroup: 'Finnish favourites',
          sortOrder: 101,
        }),
      ]),
    );
  });

  it('orders custom output groups and the channels inside them', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const sportsChannelId = '00000000-0000-4000-8000-000000000041';
    const newsChannelId = '00000000-0000-4000-8000-000000000042';
    repository.channels = [
      {
        id: '00000000-0000-4000-8000-000000000040',
        sourceId: source.id,
        providerName: 'Yle TV1',
        providerGroup: 'Finland',
        enabled: true,
        sortOrder: 10,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-05T00:00:00.000Z',
      },
      {
        id: sportsChannelId,
        sourceId: source.id,
        providerName: 'Sports one',
        providerGroup: 'Sports',
        customGroup: 'My favourites',
        enabled: true,
        sortOrder: 20,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-05T00:00:00.000Z',
      },
      {
        id: newsChannelId,
        sourceId: source.id,
        providerName: 'News one',
        providerGroup: 'News',
        customGroup: 'My favourites',
        enabled: true,
        sortOrder: 30,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-05T00:00:00.000Z',
      },
    ];
    repository.latestEntriesBySource.set(source.id, [
      {
        duration: -1,
        attributes: { 'group-title': 'Finland' },
        name: 'Yle TV1',
        url: 'http://provider.test/finland',
        mediaType: 'live',
        lineNumber: 1,
      },
      {
        duration: -1,
        attributes: { 'group-title': 'Sports' },
        name: 'Sports one',
        url: 'http://provider.test/sports',
        mediaType: 'live',
        lineNumber: 2,
      },
      {
        duration: -1,
        attributes: { 'group-title': 'News' },
        name: 'News one',
        url: 'http://provider.test/news',
        mediaType: 'live',
        lineNumber: 3,
      },
    ]);
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const initialGroups = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/output-groups`,
    });
    const groupOrder = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/output-groups/order`,
      payload: { outputGroups: ['My favourites', 'Finland'] },
    });
    const orderedGroups = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/output-groups`,
    });
    const groupChannels = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/channels?outputGroup=My%20favourites&limit=20`,
    });
    const channelOrder = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/output-groups/channels/order`,
      payload: {
        outputGroup: 'My favourites',
        channelIds: [newsChannelId, sportsChannelId],
      },
    });
    const reorderedChannels = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/channels?outputGroup=My%20favourites&limit=20`,
    });

    expect(initialGroups.json().groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'My favourites',
          entryCount: 2,
          behavior: 'permanent',
        }),
      ]),
    );
    expect(groupOrder.statusCode).toBe(204);
    expect(orderedGroups.json().groups[0]).toEqual(
      expect.objectContaining({ name: 'My favourites', sortOrder: 0 }),
    );
    expect(
      groupChannels
        .json()
        .channels.map((channel: { id: string }) => channel.id),
    ).toEqual([sportsChannelId, newsChannelId]);
    expect(channelOrder.statusCode).toBe(204);
    expect(
      reorderedChannels
        .json()
        .channels.map((channel: { id: string }) => channel.id),
    ).toEqual([newsChannelId, sportsChannelId]);
  });

  it('reviews, manually resolves, unlocks, and bulk-updates channel changes', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const missingChannelId = '00000000-0000-4000-8000-000000000010';
    const newChannelId = '00000000-0000-4000-8000-000000000011';
    const upstreamItemId = '00000000-0000-4000-8000-000000000012';
    repository.channels = [
      {
        id: missingChannelId,
        sourceId: source.id,
        providerName: 'Yle TV1',
        providerGroup: 'Finland',
        enabled: true,
        customName: 'Yle One',
        sortOrder: 2,
        matchLocked: false,
        reconciliationStatus: 'missing',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
      {
        id: newChannelId,
        sourceId: source.id,
        providerName: 'Yle News HD',
        providerGroup: 'Finland',
        enabled: true,
        tvgId: 'yle-news.fi',
        sortOrder: 4,
        matchLocked: false,
        reconciliationStatus: 'new',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
    ];
    repository.reviewCandidates = [
      {
        upstreamItemId,
        providerName: 'Yle News HD',
        providerGroup: 'Finland',
        tvgId: 'yle-news.fi',
        linkedChannelId: newChannelId,
        linkedChannelStatus: 'new',
      },
    ];
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const reviewResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/channel-review`,
    });
    const resolveResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${source.id}/channels/${missingChannelId}/resolve`,
      payload: { upstreamItemId },
    });
    const unlockResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${source.id}/channels/${missingChannelId}/unlock-match`,
    });
    const bulkResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sources/${source.id}/channels`,
      payload: {
        channelIds: [missingChannelId],
        update: { enabled: false, customGroup: 'Reviewed channels' },
      },
    });

    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewResponse.json()).toEqual(
      expect.objectContaining({ missingCount: 1, newCount: 1 }),
    );
    expect(resolveResponse.statusCode).toBe(200);
    expect(resolveResponse.json().channel).toEqual(
      expect.objectContaining({
        id: missingChannelId,
        providerName: 'Yle News HD',
        customName: 'Yle One',
        matchLocked: true,
        reconciliationStatus: 'matched',
      }),
    );
    expect(unlockResponse.statusCode).toBe(200);
    expect(unlockResponse.json().channel.matchLocked).toBe(false);
    expect(bulkResponse.statusCode).toBe(200);
    expect(bulkResponse.json()).toEqual({ updatedCount: 1 });
    expect(repository.channels).toHaveLength(1);
    expect(repository.channels[0]).toEqual(
      expect.objectContaining({
        id: missingChannelId,
        enabled: false,
        customGroup: 'Reviewed channels',
      }),
    );
  });

  it('reviews, locks, searches, and unlocks EPG mappings', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const channelId = '00000000-0000-4000-8000-000000000021';
    repository.channels = [
      {
        id: channelId,
        sourceId: source.id,
        providerName: 'YLE Primary',
        providerGroup: 'Finland',
        tvgId: 'wrong-id',
        enabled: true,
        sortOrder: 1,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
    ];
    repository.latestEpg = {
      channels: [{ id: 'yle1.fi', displayName: 'Yle TV1' }],
      programmes: [],
    };
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const initialReview = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/epg-mappings`,
    });
    const guideSearch = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/epg-channels?search=yle`,
    });
    const saveResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/channels/${channelId}/epg-mapping`,
      payload: { epgChannelId: 'yle1.fi' },
    });
    const lockedReview = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/epg-mappings`,
    });
    const unlockResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sources/${source.id}/channels/${channelId}/epg-mapping`,
    });

    expect(initialReview.statusCode).toBe(200);
    expect(initialReview.json()).toEqual(
      expect.objectContaining({ missingCount: 1, matchedCount: 0 }),
    );
    expect(guideSearch.statusCode).toBe(200);
    expect(guideSearch.json().channels).toEqual([
      expect.objectContaining({ id: 'yle1.fi', displayName: 'Yle TV1' }),
    ]);
    expect(saveResponse.statusCode).toBe(200);
    expect(lockedReview.json()).toEqual(
      expect.objectContaining({ matchedCount: 1, manualCount: 1 }),
    );
    expect(lockedReview.json().mappings[0]).toEqual(
      expect.objectContaining({
        channelId,
        epgChannelId: 'yle1.fi',
        manuallyLocked: true,
      }),
    );
    expect(unlockResponse.statusCode).toBe(204);
  });

  it('excludes never-mappable channels from EPG review and lists them separately', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const separatorId = '00000000-0000-4000-8000-000000000031';
    const realId = '00000000-0000-4000-8000-000000000032';
    repository.channels = [
      {
        id: separatorId,
        sourceId: source.id,
        providerName: '-=Finland=-',
        providerGroup: 'Finland',
        enabled: true,
        sortOrder: 1,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
      {
        id: realId,
        sourceId: source.id,
        providerName: 'Yle TV1',
        providerGroup: 'Finland',
        tvgId: 'yle1.fi',
        enabled: true,
        sortOrder: 2,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
    ];
    repository.latestEpg = {
      channels: [{ id: 'yle1.fi', displayName: 'Yle TV1' }],
      programmes: [],
    };
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const excludeResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sources/${source.id}/channels`,
      payload: { channelIds: [separatorId], update: { epgExcluded: true } },
    });
    const mappableReview = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/epg-mappings`,
    });
    const excludedReview = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/epg-mappings?view=excluded`,
    });
    const includeResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/sources/${source.id}/channels/${separatorId}`,
      payload: { epgExcluded: false },
    });
    const restoredReview = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/epg-mappings`,
    });

    expect(excludeResponse.statusCode).toBe(200);
    expect(excludeResponse.json()).toEqual({ updatedCount: 1 });
    expect(mappableReview.statusCode).toBe(200);
    expect(mappableReview.json()).toEqual(
      expect.objectContaining({ excludedCount: 1, total: 1, matchedCount: 1 }),
    );
    expect(
      mappableReview
        .json()
        .mappings.some(
          (mapping: { channelId: string }) => mapping.channelId === separatorId,
        ),
    ).toBe(false);
    expect(excludedReview.statusCode).toBe(200);
    expect(excludedReview.json().mappings).toEqual([
      expect.objectContaining({
        channelId: separatorId,
        channelName: '-=Finland=-',
        status: 'excluded',
      }),
    ]);
    expect(includeResponse.statusCode).toBe(200);
    expect(includeResponse.json().channel.epgExcluded).toBeUndefined();
    expect(restoredReview.json()).toEqual(
      expect.objectContaining({ excludedCount: 0, total: 2 }),
    );
  });

  it('bulk-marks provider groups as events and toggles publishing', async () => {
    const repository = new MemorySourceRepository();
    const source = await repository.createSource({
      name: 'Home provider',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/list' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    repository.latestEntries = ['Events A', 'Events B', 'Finland'].map(
      (group, index) => ({
        duration: -1,
        attributes: { 'tvg-name': `Entry ${index}`, 'group-title': group },
        name: `Entry ${index}`,
        url: `http://provider.test/synthetic/${index}`,
        mediaType: 'live' as const,
        lineNumber: index + 1,
      }),
    );
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const markResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/group-policies/bulk`,
      payload: {
        groupNames: ['Events A', 'Events B', 'No such group'],
        update: { behavior: 'event' },
      },
    });
    const groupsAfterMark = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/groups`,
    });
    const unpublishResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/group-policies/bulk`,
      payload: {
        groupNames: ['Events A'],
        update: { enabled: false },
      },
    });
    const groupsAfterUnpublish = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/groups`,
    });
    const emptyUpdateResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/group-policies/bulk`,
      payload: { groupNames: ['Events A'], update: {} },
    });

    expect(markResponse.statusCode).toBe(200);
    expect(markResponse.json()).toEqual({ updatedCount: 2 });
    const marked = groupsAfterMark.json().groups as Array<{
      providerGroup: string;
      behavior: string;
      enabled: boolean;
    }>;
    expect(marked.find((group) => group.providerGroup === 'Events A')).toEqual(
      expect.objectContaining({ behavior: 'event', enabled: true }),
    );
    expect(marked.find((group) => group.providerGroup === 'Events B')).toEqual(
      expect.objectContaining({ behavior: 'event', enabled: true }),
    );
    expect(marked.find((group) => group.providerGroup === 'Finland')).toEqual(
      expect.objectContaining({ behavior: 'permanent' }),
    );
    expect(unpublishResponse.statusCode).toBe(200);
    const unpublished = groupsAfterUnpublish.json().groups as Array<{
      providerGroup: string;
      behavior: string;
      enabled: boolean;
    }>;
    expect(
      unpublished.find((group) => group.providerGroup === 'Events A'),
    ).toEqual(expect.objectContaining({ behavior: 'event', enabled: false }));
    expect(
      unpublished.find((group) => group.providerGroup === 'Events B'),
    ).toEqual(expect.objectContaining({ behavior: 'event', enabled: true }));
    expect(emptyUpdateResponse.statusCode).toBe(400);

    const renameResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/group-policies/bulk`,
      payload: {
        groupNames: ['Finland'],
        update: { outputGroupName: 'Suomi' },
      },
    });
    const groupsAfterRename = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/groups`,
    });
    const clearResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/group-policies/bulk`,
      payload: {
        groupNames: ['Finland'],
        update: { outputGroupName: null },
      },
    });
    const groupsAfterClear = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/groups`,
    });

    expect(renameResponse.statusCode).toBe(200);
    expect(
      (
        groupsAfterRename.json().groups as Array<{
          providerGroup: string;
          behavior: string;
          outputGroupName?: string;
        }>
      ).find((group) => group.providerGroup === 'Finland'),
    ).toEqual(
      expect.objectContaining({
        behavior: 'permanent',
        outputGroupName: 'Suomi',
      }),
    );
    expect(clearResponse.statusCode).toBe(200);
    expect(
      (
        groupsAfterClear.json().groups as Array<{
          providerGroup: string;
          outputGroupName?: string;
        }>
      ).find((group) => group.providerGroup === 'Finland')?.outputGroupName,
    ).toBeUndefined();
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

    const outputGroupOrderResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${source.id}/output-groups/order`,
      payload: {
        outputGroups: ["Today's Finnish Sports", 'Finland'],
      },
    });
    const groupsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/output-groups`,
    });
    expect(outputGroupOrderResponse.statusCode).toBe(204);
    expect(groupsResponse.json().groups).toEqual([
      expect.objectContaining({
        name: "Today's Finnish Sports",
        behavior: 'event',
        sortOrder: 0,
      }),
      expect.objectContaining({
        name: 'Finland',
        behavior: 'permanent',
        sortOrder: 1,
      }),
    ]);

    const eventReviewResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${source.id}/events?referenceDate=2026-08-04`,
    });
    expect(eventReviewResponse.statusCode).toBe(200);
    const eventReview = eventReviewResponse.json();
    expect(eventReview).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          groupCount: 1,
          totalEntries: 2,
          hiddenEntries: 1,
          localizedEntries: 1,
        }),
        groups: [
          expect.objectContaining({
            groupName: 'MTV Urheilu Events FI',
            entries: expect.arrayContaining([
              expect.objectContaining({
                originalName: '17:00 Tennis 8/4',
                localizedName: '18:00 Tennis 8/4',
                status: 'localized',
              }),
              expect.objectContaining({
                originalName: 'Reload your playlist',
                hidden: true,
              }),
            ]),
          }),
        ],
      }),
    );
    expect(JSON.stringify(eventReview)).not.toContain('provider.test');

    const profileResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/output-profiles',
      payload: { sourceIds: [source.id], name: 'Living room TiviMate' },
    });
    const playlistPath = profileResponse.json().profile.playlistPath as string;
    const epgPath = profileResponse.json().profile.epgPath as string;
    const accessToken = profileResponse.json().profile.accessToken as string;
    const activeProfilesResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/output-profiles',
    });
    const playlistResponse = await app.inject({
      method: 'GET',
      url: playlistPath,
    });
    const epgResponse = await app.inject({ method: 'GET', url: epgPath });
    const legacyPlaylistResponse = await app.inject({
      method: 'GET',
      url: `/p/${accessToken}/playlist.m3u`,
    });
    const legacyEpgResponse = await app.inject({
      method: 'GET',
      url: `/p/${accessToken}/epg.xml`,
    });

    expect(profileResponse.statusCode).toBe(201);
    expect(playlistPath).toBe(`/m/${accessToken}`);
    expect(epgPath).toBe(`/e/${accessToken}`);
    expect(activeProfilesResponse.statusCode).toBe(200);
    expect(activeProfilesResponse.json()).toEqual({
      profiles: [
        expect.objectContaining({
          accessToken,
          name: 'Living room TiviMate',
          recoverable: true,
          sourceIds: [source.id],
        }),
      ],
    });
    expect(playlistResponse.statusCode).toBe(200);
    expect(playlistResponse.headers['content-type']).toContain(
      'audio/x-mpegurl',
    );
    expect(playlistResponse.body).toContain('Yle TV1');
    expect(playlistResponse.body).toContain('18:00 Tennis 8/4');
    expect(playlistResponse.body).toContain(
      'group-title="Today\'s Finnish Sports"',
    );
    expect(playlistResponse.body.indexOf('18:00 Tennis 8/4')).toBeLessThan(
      playlistResponse.body.indexOf('Yle TV1'),
    );
    expect(playlistResponse.body).not.toContain('Reload your playlist');
    expect(epgResponse.statusCode).toBe(200);
    expect(epgResponse.headers['content-type']).toContain('application/xml');
    expect(epgResponse.body).toContain('<display-name>Yle TV1</display-name>');
    expect(epgResponse.body).toContain('Synthetic news');
    expect(epgResponse.body).toContain('start="20260804150000 +0000"');
    expect(legacyPlaylistResponse.statusCode).toBe(200);
    expect(legacyEpgResponse.statusCode).toBe(200);

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

  it('creates custom categories, persists drag ordering, and combines providers', async () => {
    const repository = new MemorySourceRepository();
    const firstSource = await repository.createSource({
      name: 'Provider one',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/one' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    const secondSource = await repository.createSource({
      name: 'Provider two',
      sourceType: 'm3u',
      credentials: { playlistUrl: 'http://provider.test/two' },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    });
    repository.channels = [
      {
        id: '00000000-0000-4000-8000-000000000011',
        sourceId: firstSource.id,
        providerName: 'Alpha one',
        providerGroup: 'Alpha',
        enabled: true,
        sortOrder: 0,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-05T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        sourceId: firstSource.id,
        providerName: 'Beta one',
        providerGroup: 'Beta',
        enabled: true,
        sortOrder: 1,
        matchLocked: false,
        reconciliationStatus: 'matched',
        updatedAt: '2026-08-05T00:00:00.000Z',
      },
    ];
    repository.latestEntriesBySource.set(firstSource.id, [
      {
        duration: -1,
        attributes: { 'tvg-id': 'shared', 'group-title': 'Alpha' },
        name: 'Provider one channel',
        url: 'http://provider.test/one/1',
        mediaType: 'live',
        lineNumber: 1,
      },
    ]);
    repository.latestEntriesBySource.set(secondSource.id, [
      {
        duration: -1,
        attributes: { 'tvg-id': 'shared', 'group-title': 'Beta' },
        name: 'Provider two channel',
        url: 'http://provider.test/two/1',
        mediaType: 'live',
        lineNumber: 1,
      },
    ]);
    repository.latestEpgBySource.set(firstSource.id, {
      channels: [{ id: 'shared', displayName: 'Provider one guide' }],
      programmes: [],
    });
    repository.latestEpgBySource.set(secondSource.id, {
      channels: [{ id: 'shared', displayName: 'Provider two guide' }],
      programmes: [],
    });
    const app = await buildApp({ sourceRepository: repository });
    applications.push(app);

    const categoryResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/sources/${firstSource.id}/custom-categories`,
      payload: { name: 'Finnish favourites' },
    });
    const categoryListResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/sources/${firstSource.id}/custom-categories`,
    });
    const groupOrderResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${firstSource.id}/permanent-groups/order`,
      payload: { providerGroups: ['Beta', 'Alpha'] },
    });
    const channelOrderResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/sources/${firstSource.id}/channels/order`,
      payload: {
        providerGroup: 'Alpha',
        channelIds: ['00000000-0000-4000-8000-000000000011'],
      },
    });
    const profileResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/output-profiles',
      payload: {
        sourceIds: [firstSource.id, secondSource.id],
        name: 'Combined room',
      },
    });
    const playlistPath = profileResponse.json().profile.playlistPath as string;
    const epgPath = profileResponse.json().profile.epgPath as string;
    const playlistResponse = await app.inject({
      method: 'GET',
      url: playlistPath,
    });
    const epgResponse = await app.inject({ method: 'GET', url: epgPath });

    expect(categoryResponse.statusCode).toBe(201);
    expect(categoryListResponse.json().categories).toEqual([
      expect.objectContaining({ name: 'Finnish favourites', channelCount: 0 }),
    ]);
    expect(groupOrderResponse.statusCode).toBe(204);
    expect(channelOrderResponse.statusCode).toBe(204);
    expect(profileResponse.statusCode).toBe(201);
    expect(playlistResponse.body).toContain(
      `tvg-id="${firstSource.id}:shared"`,
    );
    expect(playlistResponse.body).toContain(
      `tvg-id="${secondSource.id}:shared"`,
    );
    expect(epgResponse.body).toContain(`channel id="${firstSource.id}:shared"`);
    expect(epgResponse.body).toContain(
      `channel id="${secondSource.id}:shared"`,
    );
  });
});
