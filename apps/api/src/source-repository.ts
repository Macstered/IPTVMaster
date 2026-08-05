import {
  DEFAULT_PLACEHOLDER_PATTERNS,
  decryptSecret,
  encryptSecret,
  SnapshotRejectedError,
  validateSnapshotCandidate,
  type M3uEntry,
  type NumericDateOrder,
  type OutputGroupPolicy,
  type PlaylistInspection,
  type XmltvChannel,
  type XmltvInspection,
  type XmltvProgramme,
} from '@iptvmaster/core';
import { createHash, randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

import {
  reconcileChannels,
  type ReconciliationChannel,
  type ReconciliationItem,
} from './channel-reconciliation.js';
import {
  reconcileEpgMappings,
  type EpgGuideChannel,
  type EpgPlaylistChannel,
  type LockedEpgMapping,
} from './epg-reconciliation.js';

export interface SourceCredentials {
  playlistUrl: string;
  epgUrl?: string;
}

export interface CreateSourceInput {
  name: string;
  sourceType: 'm3u' | 'xtream';
  credentials: SourceCredentials;
  sourceTimezone: string;
  displayTimezone: string;
}

export interface UpdateSourceInput {
  name: string;
  playlistUrl?: string;
  epgUrl?: string;
  deriveEpgUrl?: boolean;
  clearEpgUrl?: boolean;
  sourceTimezone: string;
  displayTimezone: string;
}

export interface DeleteSourceResult {
  revokedOutputProfiles: number;
}

export interface SafeSource {
  id: string;
  name: string;
  sourceType: 'm3u' | 'xtream';
  sourceTimezone: string;
  displayTimezone: string;
  enabled: boolean;
  hasEpgUrl: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSnapshotSummary {
  id: string;
  sourceId: string;
  fingerprint: string;
  importedAt: string;
  liveCount: number;
  skippedEntries: number;
  issueCount: number;
  unchanged: boolean;
}

export interface SnapshotHistoryItem {
  id: string;
  sourceId: string;
  fingerprint: string;
  importedAt: string;
  liveCount: number;
  skippedEntries: number;
  issueCount: number;
  isCurrent: boolean;
}

export type SourceActivityKind =
  | 'playlist-sync'
  | 'epg-sync'
  | 'manual-match'
  | 'manual-unlock'
  | 'manual-epg-map'
  | 'manual-epg-unlock'
  | 'snapshot-activate'
  | 'snapshot-reactivate';

export interface SourceActivityEvent {
  id: string;
  kind: SourceActivityKind;
  occurredAt: string;
  title: string;
  detail: string;
  status?: 'succeeded' | 'failed' | 'rejected';
}

export interface SourceHistory {
  snapshots: SnapshotHistoryItem[];
  activity: SourceActivityEvent[];
}

export interface StoredEpgSummary {
  sourceId: string;
  fingerprint: string;
  importedAt: string;
  channelCount: number;
  programmeCount: number;
  issueCount: number;
  unchanged: boolean;
}

export interface StoredEpgGuide {
  channels: XmltvChannel[];
  programmes: XmltvProgramme[];
}

export interface GroupSummary {
  providerGroup: string;
  channelCount: number;
  configured: boolean;
  behavior: 'permanent' | 'event';
  enabled: boolean;
  outputGroupName?: string;
  hidePlaceholders: boolean;
  placeholderPatterns?: string[];
  sourceTimeZone: string;
  displayTimeZone: string;
  numericDateOrder: NumericDateOrder;
}

export interface SaveGroupPolicyInput {
  groupName: string;
  behavior: 'permanent' | 'event';
  enabled: boolean;
  outputGroupName?: string;
  hidePlaceholders: boolean;
  placeholderPatterns?: string[];
  sourceTimeZone?: string;
  displayTimeZone?: string;
  numericDateOrder?: NumericDateOrder;
}

export type PermanentGroupOutputStatus = 'provider' | 'custom' | 'mixed';

export interface PermanentGroupSummary {
  providerGroup: string;
  channelCount: number;
  enabledCount: number;
  hiddenCount: number;
  firstSortOrder: number;
  outputGroupStatus: PermanentGroupOutputStatus;
  outputGroupName?: string;
}

export interface UpdatePermanentGroupInput {
  enabled?: boolean;
  customGroup?: string | null;
  startSortOrder?: number;
}

export interface CustomCategory {
  name: string;
  channelCount: number;
}

export type ChannelReconciliationStatus =
  'matched' | 'new' | 'missing' | 'ambiguous';

export interface ChannelSummary {
  id: string;
  sourceId: string;
  providerName: string;
  providerGroup: string;
  tvgId?: string;
  providerLogoUrl?: string;
  enabled: boolean;
  customName?: string;
  customGroup?: string;
  customLogoUrl?: string;
  sortOrder: number;
  matchLocked: boolean;
  matchConfidence?: number;
  reconciliationStatus: ChannelReconciliationStatus;
  lastSeenAt?: string;
  updatedAt: string;
}

export interface ChannelListFilters {
  search?: string;
  group?: string;
  status?: ChannelReconciliationStatus;
  limit: number;
  offset: number;
}

export interface ChannelListPage {
  channels: ChannelSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpdateChannelInput {
  enabled?: boolean;
  customName?: string | null;
  customGroup?: string | null;
  customLogoUrl?: string | null;
  sortOrder?: number;
}

export interface BulkUpdateChannelInput {
  enabled?: boolean;
  customGroup?: string | null;
  customLogoUrl?: string | null;
}

export interface BulkUpdateChannelResult {
  updatedCount: number;
}

export interface ReconciliationCandidate {
  upstreamItemId: string;
  providerName: string;
  providerGroup: string;
  tvgId?: string;
  providerLogoUrl?: string;
  linkedChannelId?: string;
  linkedChannelStatus?: ChannelReconciliationStatus;
}

export interface ReconciliationReview {
  unresolvedChannels: ChannelSummary[];
  candidates: ReconciliationCandidate[];
  ambiguousCount: number;
  missingCount: number;
  newCount: number;
  candidateTotal: number;
  truncated: boolean;
}

export type EpgMappingStatus = 'matched' | 'missing' | 'ambiguous';

export interface EpgGuideChannelSummary {
  id: string;
  displayName: string;
  iconUrl?: string;
}

export interface EpgMappingReviewItem {
  channelId: string;
  channelName: string;
  providerGroup: string;
  tvgId?: string;
  status: EpgMappingStatus;
  manuallyLocked: boolean;
  epgChannelId?: string;
  epgDisplayName?: string;
  confidence?: number;
  candidateIds: string[];
}

export interface EpgMappingReview {
  mappings: EpgMappingReviewItem[];
  matchedCount: number;
  missingCount: number;
  ambiguousCount: number;
  manualCount: number;
  total: number;
  truncated: boolean;
}

export interface EpgGuideChannelPage {
  channels: EpgGuideChannelSummary[];
  total: number;
  truncated: boolean;
}

export class ManualMatchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualMatchConflictError';
  }
}

export class SnapshotActivationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotActivationConflictError';
  }
}

export class XmltvDerivationError extends Error {
  constructor() {
    super(
      'The saved playlist URL does not end in get.php, so an XMLTV URL cannot be derived automatically',
    );
    this.name = 'XmltvDerivationError';
  }
}

export interface CreatedOutputProfile {
  id: string;
  name: string;
  accessToken: string;
  playlistPath: string;
  epgPath: string;
}

export interface ResolvedOutputProfile {
  id: string;
  name: string;
  sourceIds: string[];
}

export interface SourceRepository {
  createSource(input: CreateSourceInput): Promise<SafeSource>;
  updateSource(
    sourceId: string,
    input: UpdateSourceInput,
  ): Promise<SafeSource | null>;
  deleteSource(sourceId: string): Promise<DeleteSourceResult | null>;
  listSources(): Promise<SafeSource[]>;
  getSourceCredentials(sourceId: string): Promise<SourceCredentials | null>;
  savePlaylistSnapshot(
    sourceId: string,
    inspection: PlaylistInspection,
  ): Promise<StoredSnapshotSummary>;
  listSourceHistory(sourceId: string, limit: number): Promise<SourceHistory>;
  activateSnapshot(
    sourceId: string,
    snapshotId: string,
  ): Promise<SnapshotHistoryItem | null>;
  saveEpgSnapshot(
    sourceId: string,
    inspection: XmltvInspection,
  ): Promise<StoredEpgSummary>;
  getLatestEpg(sourceId: string): Promise<StoredEpgGuide>;
  getLatestPlaylistEntries(sourceId: string): Promise<M3uEntry[]>;
  listGroups(sourceId: string): Promise<GroupSummary[]>;
  saveGroupPolicy(
    sourceId: string,
    input: SaveGroupPolicyInput,
  ): Promise<GroupSummary>;
  listChannels(
    sourceId: string,
    filters: ChannelListFilters,
  ): Promise<ChannelListPage>;
  listPermanentGroups?(sourceId: string): Promise<PermanentGroupSummary[]>;
  updatePermanentGroup?(
    sourceId: string,
    providerGroup: string,
    input: UpdatePermanentGroupInput,
  ): Promise<BulkUpdateChannelResult>;
  reorderPermanentGroups?(
    sourceId: string,
    providerGroups: string[],
  ): Promise<void>;
  reorderChannels?(
    sourceId: string,
    providerGroup: string,
    channelIds: string[],
  ): Promise<void>;
  listCustomCategories?(sourceId: string): Promise<CustomCategory[]>;
  createCustomCategory?(
    sourceId: string,
    name: string,
  ): Promise<CustomCategory>;
  updateChannel(
    sourceId: string,
    channelId: string,
    input: UpdateChannelInput,
  ): Promise<ChannelSummary | null>;
  bulkUpdateChannels(
    sourceId: string,
    channelIds: string[],
    input: BulkUpdateChannelInput,
  ): Promise<BulkUpdateChannelResult>;
  getReconciliationReview(
    sourceId: string,
    search: string | undefined,
    limit: number,
  ): Promise<ReconciliationReview>;
  resolveChannelMatch(
    sourceId: string,
    channelId: string,
    upstreamItemId: string,
  ): Promise<ChannelSummary | null>;
  unlockChannelMatch(
    sourceId: string,
    channelId: string,
  ): Promise<ChannelSummary | null>;
  getEpgMappingReview(
    sourceId: string,
    search: string | undefined,
    limit: number,
  ): Promise<EpgMappingReview>;
  searchEpgChannels(
    sourceId: string,
    search: string | undefined,
    limit: number,
  ): Promise<EpgGuideChannelPage>;
  saveManualEpgMapping(
    sourceId: string,
    channelId: string,
    epgChannelId: string,
  ): Promise<boolean>;
  unlockEpgMapping(sourceId: string, channelId: string): Promise<boolean>;
  listOutputGroupPolicies(
    sourceId: string,
    referenceDate: string,
  ): Promise<OutputGroupPolicy[]>;
  createOutputProfile(
    sourceIds: string[],
    name: string,
  ): Promise<CreatedOutputProfile>;
  resolveOutputProfile(
    accessToken: string,
  ): Promise<ResolvedOutputProfile | null>;
  revokeOutputProfile(profileId: string): Promise<boolean>;
  close?(): Promise<void>;
}

interface SourceRow {
  id: string;
  name: string;
  source_type: 'm3u' | 'xtream';
  credential_ref: string;
  source_timezone: string;
  display_timezone: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
  encrypted_value?: string;
}

interface SnapshotRow {
  id: string;
  source_id: string;
  fingerprint: string;
  imported_at: Date;
  live_count: number;
  skipped_vod_count: number;
  issue_count: number;
}

interface SnapshotHistoryRow extends SnapshotRow {
  is_last_known_good: boolean;
}

interface SyncRunHistoryRow {
  id: string;
  sync_type: 'playlist' | 'epg';
  status: 'succeeded' | 'failed' | 'rejected';
  started_at: Date;
  finished_at: Date | null;
  summary: unknown;
  safe_error: string | null;
}

interface ChannelAuditHistoryRow {
  id: string;
  action: 'manual-match' | 'manual-unlock';
  details: unknown;
  created_at: Date;
  display_name: string;
}

interface SourceAuditHistoryRow {
  id: string;
  action: 'snapshot-activate' | 'snapshot-reactivate';
  created_at: Date;
  target_live_count: number | null;
}

interface EpgMappingAuditHistoryRow {
  id: string;
  action: 'manual-map' | 'manual-unlock';
  epg_channel_upstream_id: string | null;
  created_at: Date;
  display_name: string;
}

interface EpgStateRow {
  source_id: string;
  fingerprint: string;
  imported_at: Date;
  channel_count: number;
  programme_count: number;
  issue_count: number;
}

interface StoredEntryRow {
  original_name: string;
  encrypted_stream_url: string;
  media_type: M3uEntry['mediaType'];
  metadata: {
    attributes?: Record<string, string>;
    duration?: number | null;
    lineNumber?: number;
  };
  custom_name: string | null;
  custom_group: string | null;
  custom_logo_url: string | null;
  sort_order: number | null;
  epg_channel_upstream_id: string | null;
}

interface ChannelRow {
  id: string;
  source_id: string;
  provider_name: string;
  provider_group: string;
  tvg_id: string | null;
  provider_logo_url: string | null;
  enabled: boolean;
  custom_name: string | null;
  custom_group: string | null;
  custom_logo_url: string | null;
  sort_order: number;
  match_locked: boolean;
  match_confidence: string | number | null;
  reconciliation_status: ChannelReconciliationStatus;
  last_seen_at: Date | null;
  updated_at: Date;
  total_count?: string | number;
}

interface GroupRow {
  provider_group: string;
  channel_count: string | number;
  configured: boolean;
  behavior: 'permanent' | 'event';
  enabled: boolean;
  output_group: string | null;
  hide_placeholders: boolean;
  placeholder_patterns: unknown;
  source_timezone: string;
  display_timezone: string;
  numeric_date_order: NumericDateOrder;
}

interface PermanentGroupRow {
  provider_group: string;
  channel_count: string | number;
  enabled_count: string | number;
  first_sort_order: string | number;
  custom_group_count: string | number;
  has_provider_group: boolean;
  custom_group_name: string | null;
}

interface OutputProfileRow {
  id: string;
  name: string;
  configuration: unknown;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function outputProfileSourceIds(configuration: unknown): string[] {
  if (typeof configuration !== 'object' || configuration === null) return [];
  const record = configuration as Record<string, unknown>;
  const sourceIds = record['sourceIds'];
  if (
    Array.isArray(sourceIds) &&
    sourceIds.length > 0 &&
    sourceIds.every((value): value is string => typeof value === 'string')
  ) {
    return [...new Set(sourceIds)];
  }
  const legacySourceId = record['sourceId'];
  return typeof legacySourceId === 'string' ? [legacySourceId] : [];
}

export function deriveXmltvUrl(playlistUrl: string): string | null {
  const url = new URL(playlistUrl);
  if (!/\/get\.php$/i.test(url.pathname)) return null;
  url.pathname = url.pathname.replace(/get\.php$/i, 'xmltv.php');
  return url.toString();
}

function toSafeSource(row: SourceRow, hasEpgUrl: boolean): SafeSource {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.source_type,
    sourceTimezone: row.source_timezone,
    displayTimezone: row.display_timezone,
    enabled: row.enabled,
    hasEpgUrl,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function providerStreamId(value: string): string | null {
  try {
    const finalSegment = new URL(value).pathname
      .split('/')
      .filter(Boolean)
      .at(-1);
    if (!finalSegment) return null;
    const dot = finalSegment.lastIndexOf('.');
    return (dot > 0 ? finalSegment.slice(0, dot) : finalSegment).slice(0, 255);
  } catch {
    return null;
  }
}

function toSnapshotSummary(
  row: SnapshotRow,
  unchanged: boolean,
): StoredSnapshotSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    fingerprint: row.fingerprint,
    importedAt: row.imported_at.toISOString(),
    liveCount: row.live_count,
    skippedEntries: row.skipped_vod_count,
    issueCount: row.issue_count,
    unchanged,
  };
}

function toSnapshotHistoryItem(row: SnapshotHistoryRow): SnapshotHistoryItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    fingerprint: row.fingerprint,
    importedAt: row.imported_at.toISOString(),
    liveCount: row.live_count,
    skippedEntries: row.skipped_vod_count,
    issueCount: row.issue_count,
    isCurrent: row.is_last_known_good,
  };
}

function toGroupSummary(row: GroupRow): GroupSummary {
  const patterns = Array.isArray(row.placeholder_patterns)
    ? row.placeholder_patterns.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  return {
    providerGroup: row.provider_group,
    channelCount: Number(row.channel_count),
    configured: row.configured,
    behavior: row.behavior,
    enabled: row.enabled,
    ...(row.output_group ? { outputGroupName: row.output_group } : {}),
    hidePlaceholders: row.hide_placeholders,
    ...(row.behavior === 'event'
      ? {
          placeholderPatterns:
            patterns.length > 0 ? patterns : [...DEFAULT_PLACEHOLDER_PATTERNS],
        }
      : {}),
    sourceTimeZone: row.source_timezone,
    displayTimeZone: row.display_timezone,
    numericDateOrder: row.numeric_date_order,
  };
}

function toPermanentGroupSummary(
  row: PermanentGroupRow,
): PermanentGroupSummary {
  const customGroupCount = Number(row.custom_group_count);
  const outputGroupStatus: PermanentGroupOutputStatus =
    customGroupCount === 0
      ? 'provider'
      : customGroupCount === 1 && !row.has_provider_group
        ? 'custom'
        : 'mixed';
  const channelCount = Number(row.channel_count);
  const enabledCount = Number(row.enabled_count);
  return {
    providerGroup: row.provider_group,
    channelCount,
    enabledCount,
    hiddenCount: channelCount - enabledCount,
    firstSortOrder: Number(row.first_sort_order),
    outputGroupStatus,
    ...(outputGroupStatus === 'custom' && row.custom_group_name
      ? { outputGroupName: row.custom_group_name }
      : {}),
  };
}

function toChannelSummary(row: ChannelRow): ChannelSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    providerName: row.provider_name,
    providerGroup: row.provider_group,
    ...(row.tvg_id ? { tvgId: row.tvg_id } : {}),
    ...(row.provider_logo_url
      ? { providerLogoUrl: row.provider_logo_url }
      : {}),
    enabled: row.enabled,
    ...(row.custom_name ? { customName: row.custom_name } : {}),
    ...(row.custom_group ? { customGroup: row.custom_group } : {}),
    ...(row.custom_logo_url ? { customLogoUrl: row.custom_logo_url } : {}),
    sortOrder: row.sort_order,
    matchLocked: row.match_locked,
    ...(row.match_confidence === null
      ? {}
      : { matchConfidence: Number(row.match_confidence) }),
    reconciliationStatus: row.reconciliation_status,
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at.toISOString() } : {}),
    updatedAt: row.updated_at.toISOString(),
  };
}

function accessTokenHash(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}

function toEpgSummary(row: EpgStateRow, unchanged: boolean): StoredEpgSummary {
  return {
    sourceId: row.source_id,
    fingerprint: row.fingerprint,
    importedAt: row.imported_at.toISOString(),
    channelCount: row.channel_count,
    programmeCount: row.programme_count,
    issueCount: row.issue_count,
    unchanged,
  };
}

export class PostgresSourceRepository implements SourceRepository {
  readonly #pool: Pool;
  readonly #masterKey: string;

  constructor(connectionString: string, masterKey: string) {
    this.#pool = new Pool({ connectionString, max: 5 });
    this.#masterKey = masterKey;
    // Validate configuration before a real provider secret reaches persistence.
    encryptSecret('configuration-check', this.#masterKey);
  }

  async createSource(input: CreateSourceInput): Promise<SafeSource> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const encrypted = encryptSecret(
        JSON.stringify(input.credentials),
        this.#masterKey,
      );
      const secretResult = await client.query<{ id: string }>(
        'INSERT INTO secret_value (encrypted_value) VALUES ($1) RETURNING id',
        [encrypted],
      );
      const secretId = secretResult.rows[0]?.id;
      if (!secretId)
        throw new Error('Secret insert did not return an identifier');

      const sourceResult = await client.query<SourceRow>(
        `INSERT INTO source
          (name, source_type, credential_ref, source_timezone, display_timezone)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, source_type, source_timezone, display_timezone,
                   enabled, created_at, updated_at`,
        [
          input.name,
          input.sourceType,
          secretId,
          input.sourceTimezone,
          input.displayTimezone,
        ],
      );
      const source = sourceResult.rows[0];
      if (!source) throw new Error('Source insert did not return a row');
      await client.query('COMMIT');
      return toSafeSource(source, input.credentials.epgUrl !== undefined);
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateSource(
    sourceId: string,
    input: UpdateSourceInput,
  ): Promise<SafeSource | null> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const sourceResult = await client.query<SourceRow>(
        `SELECT s.id, s.name, s.source_type, s.source_timezone,
                s.display_timezone, s.enabled, s.created_at, s.updated_at,
                s.credential_ref, v.encrypted_value
           FROM source s
           JOIN secret_value v ON v.id = s.credential_ref
          WHERE s.id = $1
          FOR UPDATE OF s, v`,
        [sourceId],
      );
      const existing = sourceResult.rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return null;
      }

      const existingCredentials = this.#decryptCredentials(
        existing.encrypted_value ?? '',
      );
      const playlistUrl = input.playlistUrl ?? existingCredentials.playlistUrl;
      const derivedEpgUrl = input.deriveEpgUrl
        ? deriveXmltvUrl(playlistUrl)
        : undefined;
      if (input.deriveEpgUrl && !derivedEpgUrl) {
        throw new XmltvDerivationError();
      }
      const credentials: SourceCredentials = {
        playlistUrl,
        ...(input.clearEpgUrl
          ? {}
          : input.epgUrl
            ? { epgUrl: input.epgUrl }
            : derivedEpgUrl
              ? { epgUrl: derivedEpgUrl }
              : existingCredentials.epgUrl
                ? { epgUrl: existingCredentials.epgUrl }
                : {}),
      };
      const encrypted = encryptSecret(
        JSON.stringify(credentials),
        this.#masterKey,
      );
      await client.query(
        `UPDATE secret_value
            SET encrypted_value = $2
          WHERE id = $1`,
        [existing.credential_ref, encrypted],
      );
      const updatedResult = await client.query<SourceRow>(
        `UPDATE source
            SET name = $2, source_timezone = $3, display_timezone = $4,
                updated_at = NOW()
          WHERE id = $1
          RETURNING id, name, source_type, source_timezone, display_timezone,
                    enabled, created_at, updated_at`,
        [sourceId, input.name, input.sourceTimezone, input.displayTimezone],
      );
      const updated = updatedResult.rows[0];
      if (!updated) throw new Error('Source update did not return a row');
      await client.query('COMMIT');
      return toSafeSource(updated, credentials.epgUrl !== undefined);
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteSource(sourceId: string): Promise<DeleteSourceResult | null> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const sourceResult = await client.query<{ credential_ref: string }>(
        `SELECT credential_ref FROM source WHERE id = $1 FOR UPDATE`,
        [sourceId],
      );
      const source = sourceResult.rows[0];
      if (!source) {
        await client.query('ROLLBACK');
        return null;
      }
      const profiles = await client.query(
        `UPDATE output_profile
            SET enabled = FALSE
          WHERE enabled = TRUE
            AND (
              configuration -> 'sourceIds' ? $1
              OR configuration ->> 'sourceId' = $1
            )`,
        [sourceId],
      );
      await client.query('DELETE FROM source WHERE id = $1', [sourceId]);
      await client.query('DELETE FROM secret_value WHERE id = $1', [
        source.credential_ref,
      ]);
      await client.query('COMMIT');
      return { revokedOutputProfiles: profiles.rowCount ?? 0 };
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listSources(): Promise<SafeSource[]> {
    const result = await this.#pool.query<SourceRow>(
      `SELECT s.id, s.name, s.source_type, s.source_timezone, s.display_timezone,
              s.enabled, s.created_at, s.updated_at, v.encrypted_value
       FROM source s
       JOIN secret_value v ON v.id = s.credential_ref
       ORDER BY s.created_at ASC`,
    );

    return result.rows.map((row) => {
      const credentials = this.#decryptCredentials(row.encrypted_value ?? '');
      return toSafeSource(row, credentials.epgUrl !== undefined);
    });
  }

  async getSourceCredentials(
    sourceId: string,
  ): Promise<SourceCredentials | null> {
    const result = await this.#pool.query<{ encrypted_value: string }>(
      `SELECT v.encrypted_value
       FROM source s
       JOIN secret_value v ON v.id = s.credential_ref
       WHERE s.id = $1 AND s.enabled = TRUE`,
      [sourceId],
    );
    const row = result.rows[0];
    return row ? this.#decryptCredentials(row.encrypted_value) : null;
  }

  async savePlaylistSnapshot(
    sourceId: string,
    inspection: PlaylistInspection,
  ): Promise<StoredSnapshotSummary> {
    const client = await this.#pool.connect();
    let syncRunId: string | undefined;
    try {
      const runResult = await client.query<{ id: string }>(
        `INSERT INTO sync_run (source_id, sync_type, status)
         VALUES ($1, 'playlist', 'running')
         RETURNING id`,
        [sourceId],
      );
      syncRunId = runResult.rows[0]?.id;
      if (!syncRunId)
        throw new Error('Sync run insert did not return an identifier');

      await client.query('BEGIN');
      const sourceLock = await client.query<{ id: string }>(
        'SELECT id FROM source WHERE id = $1 FOR UPDATE',
        [sourceId],
      );
      if (!sourceLock.rows[0]) throw new Error('Source not found');

      const existing = await client.query<SnapshotHistoryRow>(
        `SELECT id, source_id, fingerprint, imported_at, live_count,
                skipped_vod_count, issue_count, is_last_known_good
         FROM source_snapshot
         WHERE source_id = $1 AND fingerprint = $2`,
        [sourceId, inspection.fingerprint],
      );
      const existingSnapshot = existing.rows[0];
      if (existingSnapshot) {
        if (!existingSnapshot.is_last_known_good) {
          await this.#activateStoredSnapshot(
            client,
            sourceId,
            existingSnapshot.id,
            'snapshot-reactivate',
          );
        }
        const summary = toSnapshotSummary(
          existingSnapshot,
          existingSnapshot.is_last_known_good,
        );
        await client.query(
          `UPDATE sync_run
           SET status = 'succeeded', finished_at = NOW(), summary = $2::jsonb
           WHERE id = $1`,
          [syncRunId, JSON.stringify(summary)],
        );
        await client.query('COMMIT');
        return summary;
      }

      const baseline = await client.query<{ live_count: number }>(
        `SELECT live_count
         FROM source_snapshot
         WHERE source_id = $1 AND is_last_known_good = TRUE`,
        [sourceId],
      );
      try {
        validateSnapshotCandidate(inspection, baseline.rows[0]?.live_count);
      } catch (error) {
        if (error instanceof SnapshotRejectedError) {
          await client.query('ROLLBACK');
          await client.query(
            `UPDATE sync_run
             SET status = 'rejected', finished_at = NOW(), safe_error = $2
             WHERE id = $1`,
            [syncRunId, error.message],
          );
          syncRunId = undefined;
        }
        throw error;
      }

      await client.query(
        'UPDATE source_snapshot SET is_last_known_good = FALSE WHERE source_id = $1',
        [sourceId],
      );
      const snapshotResult = await client.query<SnapshotRow>(
        `INSERT INTO source_snapshot
          (source_id, sync_run_id, fingerprint, live_count, skipped_vod_count,
           issue_count, is_last_known_good)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING id, source_id, fingerprint, imported_at, live_count,
                   skipped_vod_count, issue_count`,
        [
          sourceId,
          syncRunId,
          inspection.fingerprint,
          inspection.entries.length,
          inspection.skippedEntries,
          inspection.issues.length,
        ],
      );
      const snapshot = snapshotResult.rows[0];
      if (!snapshot) throw new Error('Snapshot insert did not return a row');

      const chunkSize = 1_000;
      for (
        let offset = 0;
        offset < inspection.entries.length;
        offset += chunkSize
      ) {
        const values = inspection.entries
          .slice(offset, offset + chunkSize)
          .map((entry) => ({
            provider_stream_id: providerStreamId(entry.url),
            media_type: entry.mediaType,
            original_name: entry.name,
            provider_group: entry.attributes['group-title'] ?? '',
            tvg_id: entry.attributes['tvg-id'] || null,
            tvg_name: entry.attributes['tvg-name'] || null,
            logo_url: entry.attributes['tvg-logo'] || null,
            encrypted_stream_url: encryptSecret(entry.url, this.#masterKey),
            metadata: {
              duration: entry.duration,
              attributes: entry.attributes,
              lineNumber: entry.lineNumber,
            },
          }));
        await client.query(
          `INSERT INTO upstream_item
            (snapshot_id, provider_stream_id, media_type, original_name,
             provider_group, tvg_id, tvg_name, logo_url, encrypted_stream_url,
             metadata)
           SELECT $1, item.provider_stream_id, item.media_type, item.original_name,
                  item.provider_group, item.tvg_id, item.tvg_name, item.logo_url,
                  item.encrypted_stream_url, item.metadata
           FROM jsonb_to_recordset($2::jsonb) AS item(
             provider_stream_id TEXT,
             media_type TEXT,
             original_name TEXT,
             provider_group TEXT,
             tvg_id TEXT,
             tvg_name TEXT,
             logo_url TEXT,
             encrypted_stream_url TEXT,
             metadata JSONB
           )`,
          [snapshot.id, JSON.stringify(values)],
        );
      }

      await this.#reconcileChannels(client, sourceId, snapshot.id);

      const summary = toSnapshotSummary(snapshot, false);
      await client.query(
        `UPDATE sync_run
         SET status = 'succeeded', finished_at = NOW(), summary = $2::jsonb
         WHERE id = $1`,
        [syncRunId, JSON.stringify(summary)],
      );
      await client.query('COMMIT');
      return summary;
    } catch (error) {
      await this.#safeRollback(client);
      if (syncRunId) {
        try {
          await client.query(
            `UPDATE sync_run
             SET status = 'failed', finished_at = NOW(), safe_error = $2
             WHERE id = $1`,
            [syncRunId, 'Playlist snapshot persistence failed'],
          );
        } catch {
          // The original error remains more useful to the caller.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listSourceHistory(
    sourceId: string,
    limit: number,
  ): Promise<SourceHistory> {
    const [
      snapshotsResult,
      syncResult,
      channelAuditResult,
      sourceAuditResult,
      epgMappingAuditResult,
    ] = await Promise.all([
      this.#pool.query<SnapshotHistoryRow>(
        `SELECT id, source_id, fingerprint, imported_at, live_count,
                  skipped_vod_count, issue_count, is_last_known_good
           FROM source_snapshot
           WHERE source_id = $1
           ORDER BY imported_at DESC, id DESC
           LIMIT $2`,
        [sourceId, limit],
      ),
      this.#pool.query<SyncRunHistoryRow>(
        `SELECT id, sync_type, status, started_at, finished_at, summary,
                  safe_error
           FROM sync_run
           WHERE source_id = $1 AND status <> 'running'
           ORDER BY started_at DESC, id DESC
           LIMIT $2`,
        [sourceId, limit],
      ),
      this.#pool.query<ChannelAuditHistoryRow>(
        `SELECT a.id, a.action, a.details, a.created_at,
                  COALESCE(c.custom_name, c.provider_name) AS display_name
           FROM channel_match_audit a
           JOIN channel c ON c.id = a.channel_id
           WHERE a.source_id = $1
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT $2`,
        [sourceId, limit],
      ),
      this.#pool.query<SourceAuditHistoryRow>(
        `SELECT a.id, a.action, a.created_at,
                  target.live_count AS target_live_count
           FROM source_audit_event a
           LEFT JOIN source_snapshot target ON target.id = a.to_snapshot_id
           WHERE a.source_id = $1
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT $2`,
        [sourceId, limit],
      ),
      this.#pool.query<EpgMappingAuditHistoryRow>(
        `SELECT audit.id, audit.action, audit.epg_channel_upstream_id,
                  audit.created_at,
                  COALESCE(c.custom_name, c.provider_name) AS display_name
           FROM epg_mapping_audit audit
           JOIN channel c ON c.id = audit.channel_id
           WHERE audit.source_id = $1
           ORDER BY audit.created_at DESC, audit.id DESC
           LIMIT $2`,
        [sourceId, limit],
      ),
    ]);

    const activity: SourceActivityEvent[] = [
      ...syncResult.rows.map((row) => this.#toSyncActivity(row)),
      ...channelAuditResult.rows.map((row) => {
        const details = isStringRecord(row.details) ? row.details : {};
        const providerName = details.providerName;
        return {
          id: row.id,
          kind: row.action,
          occurredAt: row.created_at.toISOString(),
          title:
            row.action === 'manual-match'
              ? `Matched ${row.display_name}`
              : `Unlocked ${row.display_name}`,
          detail:
            row.action === 'manual-match' && providerName
              ? `Linked to provider entry ${providerName}`
              : 'Automatic reconciliation may update this channel again.',
          status: 'succeeded' as const,
        };
      }),
      ...sourceAuditResult.rows.map((row) => ({
        id: row.id,
        kind: row.action,
        occurredAt: row.created_at.toISOString(),
        title:
          row.action === 'snapshot-activate'
            ? 'Snapshot restored'
            : 'Provider snapshot reactivated',
        detail:
          row.target_live_count !== null
            ? `${row.target_live_count.toLocaleString()} retained live entries became current.`
            : 'The selected retained snapshot became current.',
        status: 'succeeded' as const,
      })),
      ...epgMappingAuditResult.rows.map((row) => ({
        id: row.id,
        kind:
          row.action === 'manual-map'
            ? ('manual-epg-map' as const)
            : ('manual-epg-unlock' as const),
        occurredAt: row.created_at.toISOString(),
        title:
          row.action === 'manual-map'
            ? `Mapped EPG for ${row.display_name}`
            : `Unlocked EPG for ${row.display_name}`,
        detail:
          row.action === 'manual-map' && row.epg_channel_upstream_id
            ? `Linked to XMLTV channel ${row.epg_channel_upstream_id}.`
            : 'Automatic EPG matching may update this channel again.',
        status: 'succeeded' as const,
      })),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit);

    return {
      snapshots: snapshotsResult.rows.map(toSnapshotHistoryItem),
      activity,
    };
  }

  async activateSnapshot(
    sourceId: string,
    snapshotId: string,
  ): Promise<SnapshotHistoryItem | null> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const sourceLock = await client.query<{ id: string }>(
        'SELECT id FROM source WHERE id = $1 FOR UPDATE',
        [sourceId],
      );
      if (!sourceLock.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const targetResult = await client.query<SnapshotHistoryRow>(
        `SELECT id, source_id, fingerprint, imported_at, live_count,
                skipped_vod_count, issue_count, is_last_known_good
         FROM source_snapshot
         WHERE source_id = $1 AND id = $2
         FOR UPDATE`,
        [sourceId, snapshotId],
      );
      const target = targetResult.rows[0];
      if (!target) {
        await client.query('ROLLBACK');
        return null;
      }
      if (target.is_last_known_good) {
        throw new SnapshotActivationConflictError(
          'The selected snapshot is already current',
        );
      }
      await this.#activateStoredSnapshot(
        client,
        sourceId,
        snapshotId,
        'snapshot-activate',
      );
      await client.query('COMMIT');
      return { ...toSnapshotHistoryItem(target), isCurrent: true };
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestPlaylistEntries(sourceId: string): Promise<M3uEntry[]> {
    const result = await this.#pool.query<StoredEntryRow>(
      `SELECT i.original_name, i.encrypted_stream_url, i.media_type, i.metadata,
              c.custom_name, c.custom_group, c.custom_logo_url, c.sort_order,
              mapping.epg_channel_upstream_id
       FROM source_snapshot s
       JOIN upstream_item i ON i.snapshot_id = s.id
       LEFT JOIN channel c
         ON c.current_upstream_item_id = i.id AND c.archived_at IS NULL
       LEFT JOIN epg_mapping mapping ON mapping.channel_id = c.id
       WHERE s.source_id = $1 AND s.is_last_known_good = TRUE
         AND (c.id IS NULL OR c.enabled = TRUE)
       ORDER BY COALESCE(c.sort_order, (i.metadata->>'lineNumber')::int, 0),
                COALESCE((i.metadata->>'lineNumber')::int, 0), i.id`,
      [sourceId],
    );
    return result.rows.map((row) => {
      const attributes = { ...(row.metadata.attributes ?? {}) };
      if (row.custom_name) attributes['tvg-name'] = row.custom_name;
      if (row.custom_group) attributes['group-title'] = row.custom_group;
      if (row.custom_logo_url) attributes['tvg-logo'] = row.custom_logo_url;
      if (row.epg_channel_upstream_id) {
        attributes['tvg-id'] = row.epg_channel_upstream_id;
      }
      return {
        duration: row.metadata.duration ?? null,
        attributes,
        name: row.custom_name ?? row.original_name,
        url: decryptSecret(row.encrypted_stream_url, this.#masterKey),
        mediaType: row.media_type,
        lineNumber: row.metadata.lineNumber ?? 0,
      };
    });
  }

  async saveEpgSnapshot(
    sourceId: string,
    inspection: XmltvInspection,
  ): Promise<StoredEpgSummary> {
    const client = await this.#pool.connect();
    let syncRunId: string | undefined;
    try {
      const runResult = await client.query<{ id: string }>(
        `INSERT INTO sync_run (source_id, sync_type, status)
         VALUES ($1, 'epg', 'running')
         RETURNING id`,
        [sourceId],
      );
      syncRunId = runResult.rows[0]?.id;
      if (!syncRunId)
        throw new Error('EPG sync run did not return an identifier');

      const existing = await client.query<EpgStateRow>(
        `SELECT source_id, fingerprint, imported_at, channel_count,
                programme_count, issue_count
         FROM epg_snapshot_state
         WHERE source_id = $1`,
        [sourceId],
      );
      const previous = existing.rows[0];
      if (previous?.fingerprint === inspection.fingerprint) {
        const summary = toEpgSummary(previous, true);
        await client.query(
          `UPDATE sync_run
           SET status = 'succeeded', finished_at = NOW(), summary = $2::jsonb
           WHERE id = $1`,
          [syncRunId, JSON.stringify(summary)],
        );
        return summary;
      }

      const severeIssueCount = inspection.issues.filter(
        (issue) => issue.code !== 'missing-timezone',
      ).length;
      if (inspection.programmes.length === 0) {
        throw new SnapshotRejectedError('EPG contains no valid programmes');
      }
      if (
        previous &&
        previous.programme_count >= 100 &&
        inspection.programmes.length < previous.programme_count * 0.4
      ) {
        throw new SnapshotRejectedError(
          'EPG programme count dropped by more than 60 percent',
        );
      }
      if (
        severeIssueCount > 100 &&
        severeIssueCount > inspection.programmes.length * 0.2
      ) {
        throw new SnapshotRejectedError('EPG contains too many parse issues');
      }

      await client.query('BEGIN');
      await client.query('DELETE FROM epg_channel WHERE source_id = $1', [
        sourceId,
      ]);
      const channelChunkSize = 2_000;
      for (
        let offset = 0;
        offset < inspection.channels.length;
        offset += channelChunkSize
      ) {
        const values = inspection.channels
          .slice(offset, offset + channelChunkSize)
          .map((channel) => ({
            upstream_id: channel.id,
            display_name: channel.displayName,
            icon_url: channel.iconUrl ?? null,
          }));
        await client.query(
          `INSERT INTO epg_channel
            (source_id, upstream_id, display_name, icon_url)
           SELECT $1, item.upstream_id, item.display_name, item.icon_url
           FROM jsonb_to_recordset($2::jsonb) AS item(
             upstream_id TEXT,
             display_name TEXT,
             icon_url TEXT
           )`,
          [sourceId, JSON.stringify(values)],
        );
      }

      const programmeChunkSize = 2_000;
      for (
        let offset = 0;
        offset < inspection.programmes.length;
        offset += programmeChunkSize
      ) {
        const values = inspection.programmes
          .slice(offset, offset + programmeChunkSize)
          .map((programme) => ({
            channel_id: programme.channelId,
            starts_at: programme.start,
            stops_at: programme.stop ?? null,
            title: programme.title,
            description: programme.description ?? null,
            category: programme.category ?? null,
          }));
        await client.query(
          `INSERT INTO epg_programme
            (epg_channel_id, starts_at, stops_at, title, description, category)
           SELECT channel.id, item.starts_at::timestamptz,
                  item.stops_at::timestamptz, item.title, item.description,
                  item.category
           FROM jsonb_to_recordset($2::jsonb) AS item(
             channel_id TEXT,
             starts_at TEXT,
             stops_at TEXT,
             title TEXT,
             description TEXT,
             category TEXT
           )
           JOIN epg_channel channel
             ON channel.source_id = $1 AND channel.upstream_id = item.channel_id`,
          [sourceId, JSON.stringify(values)],
        );
      }

      await this.#reconcileEpgMappings(client, sourceId);

      const stateResult = await client.query<EpgStateRow>(
        `INSERT INTO epg_snapshot_state
          (source_id, fingerprint, channel_count, programme_count, issue_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_id) DO UPDATE SET
           fingerprint = EXCLUDED.fingerprint,
           imported_at = NOW(),
           channel_count = EXCLUDED.channel_count,
           programme_count = EXCLUDED.programme_count,
           issue_count = EXCLUDED.issue_count
         RETURNING source_id, fingerprint, imported_at, channel_count,
                   programme_count, issue_count`,
        [
          sourceId,
          inspection.fingerprint,
          inspection.channels.length,
          inspection.programmes.length,
          inspection.issues.length,
        ],
      );
      const state = stateResult.rows[0];
      if (!state) throw new Error('EPG state update did not return a row');
      const summary = toEpgSummary(state, false);
      await client.query(
        `UPDATE sync_run
         SET status = 'succeeded', finished_at = NOW(), summary = $2::jsonb
         WHERE id = $1`,
        [syncRunId, JSON.stringify(summary)],
      );
      await client.query('COMMIT');
      return summary;
    } catch (error) {
      await this.#safeRollback(client);
      if (syncRunId) {
        try {
          await client.query(
            `UPDATE sync_run
             SET status = $2, finished_at = NOW(), safe_error = $3
             WHERE id = $1`,
            [
              syncRunId,
              error instanceof SnapshotRejectedError ? 'rejected' : 'failed',
              error instanceof SnapshotRejectedError
                ? error.message
                : 'EPG snapshot persistence failed',
            ],
          );
        } catch {
          // Preserve the original import error.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestEpg(sourceId: string): Promise<StoredEpgGuide> {
    const channels = await this.#pool.query<{
      upstream_id: string;
      display_name: string;
      icon_url: string | null;
    }>(
      `SELECT upstream_id, display_name, icon_url
       FROM epg_channel
       WHERE source_id = $1
       ORDER BY display_name, upstream_id`,
      [sourceId],
    );
    const programmes = await this.#pool.query<{
      channel_id: string;
      starts_at: Date;
      stops_at: Date | null;
      title: string;
      description: string | null;
      category: string | null;
    }>(
      `SELECT channel.upstream_id AS channel_id, programme.starts_at,
              programme.stops_at, programme.title, programme.description,
              programme.category
       FROM epg_programme programme
       JOIN epg_channel channel ON channel.id = programme.epg_channel_id
       WHERE channel.source_id = $1
       ORDER BY programme.starts_at, channel.upstream_id`,
      [sourceId],
    );
    return {
      channels: channels.rows.map((row) => ({
        id: row.upstream_id,
        displayName: row.display_name,
        ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
      })),
      programmes: programmes.rows.map((row) => ({
        channelId: row.channel_id,
        start: row.starts_at.toISOString(),
        ...(row.stops_at ? { stop: row.stops_at.toISOString() } : {}),
        title: row.title,
        ...(row.description ? { description: row.description } : {}),
        ...(row.category ? { category: row.category } : {}),
      })),
    };
  }

  async listGroups(sourceId: string): Promise<GroupSummary[]> {
    const result = await this.#pool.query<GroupRow>(
      `SELECT i.provider_group,
              COUNT(*) AS channel_count,
              (p.id IS NOT NULL) AS configured,
              COALESCE(p.behavior, 'permanent') AS behavior,
              COALESCE(p.enabled, TRUE) AS enabled,
              p.output_group,
              COALESCE(p.hide_placeholders, TRUE) AS hide_placeholders,
              COALESCE(p.placeholder_patterns, '[]'::jsonb) AS placeholder_patterns,
              COALESCE(p.source_timezone, src.source_timezone) AS source_timezone,
              COALESCE(p.display_timezone, src.display_timezone) AS display_timezone,
              COALESCE(p.numeric_date_order, 'month-day') AS numeric_date_order
       FROM source_snapshot s
       JOIN source src ON src.id = s.source_id
       JOIN upstream_item i ON i.snapshot_id = s.id
       LEFT JOIN group_policy p
         ON p.source_id = s.source_id AND p.provider_group = i.provider_group
       WHERE s.source_id = $1 AND s.is_last_known_good = TRUE
       GROUP BY i.provider_group, p.id, src.source_timezone, src.display_timezone
       ORDER BY i.provider_group ASC`,
      [sourceId],
    );
    return result.rows.map(toGroupSummary);
  }

  async saveGroupPolicy(
    sourceId: string,
    input: SaveGroupPolicyInput,
  ): Promise<GroupSummary> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO group_policy
          (source_id, provider_group, behavior, enabled, output_group,
           hide_placeholders, placeholder_patterns, source_timezone,
           display_timezone, numeric_date_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         ON CONFLICT (source_id, provider_group) DO UPDATE SET
           behavior = EXCLUDED.behavior,
           enabled = EXCLUDED.enabled,
           output_group = EXCLUDED.output_group,
           hide_placeholders = EXCLUDED.hide_placeholders,
           placeholder_patterns = EXCLUDED.placeholder_patterns,
           source_timezone = EXCLUDED.source_timezone,
           display_timezone = EXCLUDED.display_timezone,
           numeric_date_order = EXCLUDED.numeric_date_order,
           updated_at = NOW()`,
        [
          sourceId,
          input.groupName,
          input.behavior,
          input.enabled,
          input.outputGroupName ?? null,
          input.hidePlaceholders,
          JSON.stringify(input.placeholderPatterns ?? []),
          input.sourceTimeZone ?? null,
          input.displayTimeZone ?? null,
          input.numericDateOrder ?? 'month-day',
        ],
      );
      const snapshot = await client.query<{ id: string }>(
        `SELECT id
         FROM source_snapshot
         WHERE source_id = $1 AND is_last_known_good = TRUE`,
        [sourceId],
      );
      if (snapshot.rows[0]) {
        await this.#reconcileChannels(client, sourceId, snapshot.rows[0].id);
      }
      await client.query('COMMIT');
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
    const group = (await this.listGroups(sourceId)).find(
      (candidate) => candidate.providerGroup === input.groupName,
    );
    if (!group)
      throw new Error('Saved group policy does not match a current group');
    return group;
  }

  async listPermanentGroups(
    sourceId: string,
  ): Promise<PermanentGroupSummary[]> {
    const result = await this.#pool.query<PermanentGroupRow>(
      `SELECT c.provider_group,
              COUNT(*) AS channel_count,
              COUNT(*) FILTER (WHERE c.enabled = TRUE) AS enabled_count,
              MIN(c.sort_order) AS first_sort_order,
              COUNT(DISTINCT c.custom_group) AS custom_group_count,
              BOOL_OR(c.custom_group IS NULL) AS has_provider_group,
              MAX(c.custom_group) FILTER (WHERE c.custom_group IS NOT NULL)
                AS custom_group_name
       FROM channel c
       LEFT JOIN group_policy p
         ON p.source_id = c.source_id AND p.provider_group = c.provider_group
       WHERE c.source_id = $1 AND c.archived_at IS NULL
         AND c.current_upstream_item_id IS NOT NULL
         AND COALESCE(p.behavior, 'permanent') = 'permanent'
       GROUP BY c.provider_group
       ORDER BY MIN(c.sort_order) ASC, c.provider_group ASC`,
      [sourceId],
    );
    return result.rows.map(toPermanentGroupSummary);
  }

  async updatePermanentGroup(
    sourceId: string,
    providerGroup: string,
    input: UpdatePermanentGroupInput,
  ): Promise<BulkUpdateChannelResult> {
    const values: unknown[] = [sourceId, providerGroup];
    const updates: string[] = [];
    const addUpdate = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };
    if (input.enabled !== undefined) addUpdate('enabled', input.enabled);
    if (input.customGroup !== undefined)
      addUpdate('custom_group', input.customGroup);
    if (input.startSortOrder !== undefined) {
      values.push(input.startSortOrder);
      updates.push(`sort_order = $${values.length} + selected.sort_offset`);
    }
    if (updates.length === 0) return { updatedCount: 0 };

    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `WITH selected AS (
           SELECT c.id,
                  ROW_NUMBER() OVER (
                    ORDER BY c.sort_order, c.provider_name, c.id
                  ) - 1 AS sort_offset
           FROM channel c
           WHERE c.source_id = $1 AND c.provider_group = $2
             AND c.archived_at IS NULL
             AND c.current_upstream_item_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1
               FROM group_policy p
               WHERE p.source_id = c.source_id
                 AND p.provider_group = c.provider_group
                 AND p.behavior = 'event'
             )
         )
         UPDATE channel c
         SET ${updates.join(', ')}, updated_at = NOW()
         FROM selected
         WHERE c.id = selected.id`,
        values,
      );
      if ((result.rowCount ?? 0) > 0) {
        await this.#reconcileEpgMappings(client, sourceId);
      }
      await client.query('COMMIT');
      return { updatedCount: result.rowCount ?? 0 };
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async reorderPermanentGroups(
    sourceId: string,
    providerGroups: string[],
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        id: string;
        provider_group: string;
        sort_order: number;
        provider_name: string;
      }>(
        `SELECT c.id, c.provider_group, c.sort_order, c.provider_name
         FROM channel c
         LEFT JOIN group_policy p
           ON p.source_id = c.source_id AND p.provider_group = c.provider_group
         WHERE c.source_id = $1 AND c.archived_at IS NULL
           AND c.current_upstream_item_id IS NOT NULL
           AND COALESCE(p.behavior, 'permanent') = 'permanent'
         ORDER BY c.provider_group, c.sort_order, c.provider_name, c.id
         FOR UPDATE OF c`,
        [sourceId],
      );
      const knownGroups = new Set(result.rows.map((row) => row.provider_group));
      const submittedGroups = new Set(providerGroups);
      if (
        providerGroups.length !== knownGroups.size ||
        submittedGroups.size !== knownGroups.size ||
        [...knownGroups].some((group) => !submittedGroups.has(group))
      ) {
        throw new Error('Permanent group order no longer matches this source');
      }
      const rank = new Map(
        providerGroups.map((group, index) => [group, index]),
      );
      const orderedChannels = [...result.rows].sort(
        (left, right) =>
          (rank.get(left.provider_group) ?? 0) -
            (rank.get(right.provider_group) ?? 0) ||
          left.sort_order - right.sort_order ||
          left.provider_name.localeCompare(right.provider_name) ||
          left.id.localeCompare(right.id),
      );
      if (orderedChannels.length > 0) {
        await client.query(
          `UPDATE channel c
           SET sort_order = change.sort_order, updated_at = NOW()
           FROM jsonb_to_recordset($1::jsonb)
             AS change(id UUID, sort_order INTEGER)
           WHERE c.id = change.id`,
          [
            JSON.stringify(
              orderedChannels.map((channel, index) => ({
                id: channel.id,
                sort_order: index,
              })),
            ),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async reorderChannels(
    sourceId: string,
    providerGroup: string,
    channelIds: string[],
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        id: string;
        sort_order: number;
      }>(
        `SELECT c.id, c.sort_order
         FROM channel c
         WHERE c.source_id = $1 AND c.provider_group = $2
           AND c.archived_at IS NULL AND c.current_upstream_item_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM group_policy p
             WHERE p.source_id = c.source_id
               AND p.provider_group = c.provider_group
               AND p.behavior = 'event'
           )
         ORDER BY c.sort_order, c.provider_name, c.id
         FOR UPDATE`,
        [sourceId, providerGroup],
      );
      const submittedIds = new Set(channelIds);
      if (
        channelIds.length !== result.rows.length ||
        submittedIds.size !== result.rows.length ||
        result.rows.some((row) => !submittedIds.has(row.id))
      ) {
        throw new Error('Channel order no longer matches this provider group');
      }
      if (channelIds.length > 0) {
        const slots = result.rows.map((row) => row.sort_order);
        await client.query(
          `UPDATE channel c
           SET sort_order = change.sort_order, updated_at = NOW()
           FROM jsonb_to_recordset($1::jsonb)
             AS change(id UUID, sort_order INTEGER)
           WHERE c.id = change.id`,
          [
            JSON.stringify(
              channelIds.map((id, index) => ({
                id,
                sort_order: slots[index],
              })),
            ),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listCustomCategories(sourceId: string): Promise<CustomCategory[]> {
    const result = await this.#pool.query<{
      name: string;
      channel_count: string | number;
      sort_order: string | number | null;
    }>(
      `WITH names AS (
         SELECT category.name, category.sort_order
         FROM custom_output_category category
         WHERE category.source_id = $1
         UNION
         SELECT DISTINCT c.custom_group AS name, NULL::INTEGER AS sort_order
         FROM channel c
         WHERE c.source_id = $1 AND c.archived_at IS NULL
           AND c.custom_group IS NOT NULL
       )
       SELECT names.name, COUNT(c.id) AS channel_count,
              MIN(names.sort_order) AS sort_order
       FROM names
       LEFT JOIN channel c
         ON c.source_id = $1 AND c.archived_at IS NULL
        AND c.custom_group = names.name
       GROUP BY names.name
       ORDER BY MIN(names.sort_order) NULLS LAST, names.name`,
      [sourceId],
    );
    return result.rows.map((row) => ({
      name: row.name,
      channelCount: Number(row.channel_count),
    }));
  }

  async createCustomCategory(
    sourceId: string,
    name: string,
  ): Promise<CustomCategory> {
    await this.#pool.query(
      `INSERT INTO custom_output_category (source_id, name, sort_order)
       SELECT $1, $2,
              COALESCE(
                (SELECT MAX(sort_order) + 1
                 FROM custom_output_category WHERE source_id = $1),
                0
              )
       WHERE EXISTS (SELECT 1 FROM source WHERE id = $1)
       ON CONFLICT (source_id, name) DO NOTHING`,
      [sourceId, name],
    );
    const categories = await this.listCustomCategories(sourceId);
    const category = categories.find((candidate) => candidate.name === name);
    if (!category) throw new Error('Source not found while creating category');
    return category;
  }

  async listChannels(
    sourceId: string,
    filters: ChannelListFilters,
  ): Promise<ChannelListPage> {
    const values: unknown[] = [sourceId];
    const conditions = [
      'c.source_id = $1',
      'c.archived_at IS NULL',
      "COALESCE(p.behavior, 'permanent') = 'permanent'",
    ];
    if (filters.search) {
      values.push(`%${filters.search}%`);
      conditions.push(
        `(c.provider_name ILIKE $${values.length}
          OR COALESCE(c.custom_name, '') ILIKE $${values.length}
          OR c.provider_group ILIKE $${values.length}
          OR COALESCE(c.custom_group, '') ILIKE $${values.length}
          OR COALESCE(c.tvg_id, '') ILIKE $${values.length})`,
      );
    }
    if (filters.group !== undefined) {
      values.push(filters.group);
      conditions.push(`c.provider_group = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`c.reconciliation_status = $${values.length}`);
    }
    values.push(filters.limit, filters.offset);
    const limitParameter = `$${values.length - 1}`;
    const offsetParameter = `$${values.length}`;
    const result = await this.#pool.query<ChannelRow>(
      `SELECT c.id, c.source_id, c.provider_name, c.provider_group, c.tvg_id,
              c.provider_logo_url, c.enabled, c.custom_name, c.custom_group,
              c.custom_logo_url, c.sort_order, c.match_locked,
              c.match_confidence, c.reconciliation_status, c.last_seen_at,
              c.updated_at, COUNT(*) OVER() AS total_count
       FROM channel c
       LEFT JOIN group_policy p
         ON p.source_id = c.source_id AND p.provider_group = c.provider_group
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(c.custom_group, c.provider_group), c.sort_order,
                COALESCE(c.custom_name, c.provider_name), c.id
       LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
      values,
    );
    return {
      channels: result.rows.map(toChannelSummary),
      total: Number(result.rows[0]?.total_count ?? 0),
      limit: filters.limit,
      offset: filters.offset,
    };
  }

  async updateChannel(
    sourceId: string,
    channelId: string,
    input: UpdateChannelInput,
  ): Promise<ChannelSummary | null> {
    const values: unknown[] = [sourceId, channelId];
    const updates: string[] = [];
    const addUpdate = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };
    if (input.enabled !== undefined) addUpdate('enabled', input.enabled);
    if (input.customName !== undefined)
      addUpdate('custom_name', input.customName);
    if (input.customGroup !== undefined)
      addUpdate('custom_group', input.customGroup);
    if (input.customLogoUrl !== undefined)
      addUpdate('custom_logo_url', input.customLogoUrl);
    if (input.sortOrder !== undefined) addUpdate('sort_order', input.sortOrder);
    if (updates.length === 0) return null;

    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<ChannelRow>(
        `UPDATE channel
         SET ${updates.join(', ')}, updated_at = NOW()
         WHERE source_id = $1 AND id = $2 AND archived_at IS NULL
         RETURNING id, source_id, provider_name, provider_group, tvg_id,
                   provider_logo_url, enabled, custom_name, custom_group,
                   custom_logo_url, sort_order, match_locked, match_confidence,
                   reconciliation_status, last_seen_at, updated_at`,
        values,
      );
      const row = result.rows[0];
      if (row) await this.#reconcileEpgMappings(client, sourceId);
      await client.query('COMMIT');
      return row ? toChannelSummary(row) : null;
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async bulkUpdateChannels(
    sourceId: string,
    channelIds: string[],
    input: BulkUpdateChannelInput,
  ): Promise<BulkUpdateChannelResult> {
    const values: unknown[] = [sourceId, channelIds];
    const updates: string[] = [];
    const addUpdate = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };
    if (input.enabled !== undefined) addUpdate('enabled', input.enabled);
    if (input.customGroup !== undefined)
      addUpdate('custom_group', input.customGroup);
    if (input.customLogoUrl !== undefined)
      addUpdate('custom_logo_url', input.customLogoUrl);
    if (updates.length === 0) return { updatedCount: 0 };

    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE channel
         SET ${updates.join(', ')}, updated_at = NOW()
         WHERE source_id = $1 AND id = ANY($2::uuid[])
           AND archived_at IS NULL`,
        values,
      );
      if ((result.rowCount ?? 0) > 0) {
        await this.#reconcileEpgMappings(client, sourceId);
      }
      await client.query('COMMIT');
      return { updatedCount: result.rowCount ?? 0 };
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getReconciliationReview(
    sourceId: string,
    search: string | undefined,
    limit: number,
  ): Promise<ReconciliationReview> {
    const countsResult = await this.#pool.query<{
      ambiguous_count: string | number;
      missing_count: string | number;
      new_count: string | number;
    }>(
      `SELECT COUNT(*) FILTER (
                WHERE c.reconciliation_status = 'ambiguous'
              ) AS ambiguous_count,
              COUNT(*) FILTER (
                WHERE c.reconciliation_status = 'missing'
              ) AS missing_count,
              COUNT(*) FILTER (
                WHERE c.reconciliation_status = 'new'
              ) AS new_count
       FROM channel c
       LEFT JOIN group_policy p
         ON p.source_id = c.source_id AND p.provider_group = c.provider_group
       WHERE c.source_id = $1 AND c.archived_at IS NULL
         AND COALESCE(p.behavior, 'permanent') = 'permanent'`,
      [sourceId],
    );
    const counts = countsResult.rows[0];
    const ambiguousCount = Number(counts?.ambiguous_count ?? 0);
    const missingCount = Number(counts?.missing_count ?? 0);
    const newCount = Number(counts?.new_count ?? 0);

    const channelValues: unknown[] = [sourceId];
    let channelSearch = '';
    if (search) {
      channelValues.push(`%${search}%`);
      channelSearch = `AND (
        c.provider_name ILIKE $2 OR COALESCE(c.custom_name, '') ILIKE $2
        OR c.provider_group ILIKE $2 OR COALESCE(c.tvg_id, '') ILIKE $2
      )`;
    }
    channelValues.push(limit);
    const unresolvedResult = await this.#pool.query<ChannelRow>(
      `SELECT c.id, c.source_id, c.provider_name, c.provider_group, c.tvg_id,
              c.provider_logo_url, c.enabled, c.custom_name, c.custom_group,
              c.custom_logo_url, c.sort_order, c.match_locked,
              c.match_confidence, c.reconciliation_status, c.last_seen_at,
              c.updated_at
       FROM channel c
       LEFT JOIN group_policy p
         ON p.source_id = c.source_id AND p.provider_group = c.provider_group
       WHERE c.source_id = $1 AND c.archived_at IS NULL
         AND c.reconciliation_status IN ('ambiguous', 'missing')
         AND COALESCE(p.behavior, 'permanent') = 'permanent'
         ${channelSearch}
       ORDER BY c.reconciliation_status, c.provider_group, c.provider_name
       LIMIT $${channelValues.length}`,
      channelValues,
    );

    const candidateValues: unknown[] = [sourceId, limit];
    const candidateResult = await this.#pool.query<{
      upstream_item_id: string;
      provider_name: string;
      provider_group: string;
      tvg_id: string | null;
      provider_logo_url: string | null;
      linked_channel_id: string | null;
      linked_channel_status: ChannelReconciliationStatus | null;
      total_count: string | number;
    }>(
      `SELECT i.id AS upstream_item_id, i.original_name AS provider_name,
              i.provider_group, i.tvg_id, i.logo_url AS provider_logo_url,
              linked.id AS linked_channel_id,
              linked.reconciliation_status AS linked_channel_status,
              COUNT(*) OVER() AS total_count
       FROM source_snapshot s
       JOIN upstream_item i ON i.snapshot_id = s.id
       LEFT JOIN group_policy p
         ON p.source_id = s.source_id AND p.provider_group = i.provider_group
       LEFT JOIN channel linked
         ON linked.current_upstream_item_id = i.id
        AND linked.archived_at IS NULL
       WHERE s.source_id = $1 AND s.is_last_known_good = TRUE
         AND i.media_type = 'live'
         AND COALESCE(p.behavior, 'permanent') = 'permanent'
         AND (linked.id IS NULL OR linked.reconciliation_status = 'new')
       ORDER BY i.provider_group, i.original_name, i.id
       LIMIT $2`,
      candidateValues,
    );
    const candidates = candidateResult.rows.map((row) => ({
      upstreamItemId: row.upstream_item_id,
      providerName: row.provider_name,
      providerGroup: row.provider_group,
      ...(row.tvg_id ? { tvgId: row.tvg_id } : {}),
      ...(row.provider_logo_url
        ? { providerLogoUrl: row.provider_logo_url }
        : {}),
      ...(row.linked_channel_id
        ? { linkedChannelId: row.linked_channel_id }
        : {}),
      ...(row.linked_channel_status
        ? { linkedChannelStatus: row.linked_channel_status }
        : {}),
    }));
    const candidateTotal = Number(candidateResult.rows[0]?.total_count ?? 0);
    return {
      unresolvedChannels: unresolvedResult.rows.map(toChannelSummary),
      candidates,
      ambiguousCount,
      missingCount,
      newCount,
      candidateTotal,
      truncated:
        ambiguousCount + missingCount > unresolvedResult.rows.length ||
        candidateTotal > candidates.length,
    };
  }

  async resolveChannelMatch(
    sourceId: string,
    channelId: string,
    upstreamItemId: string,
  ): Promise<ChannelSummary | null> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const targetResult = await client.query<ChannelRow>(
        `SELECT id, source_id, provider_name, provider_group, tvg_id,
                provider_logo_url, enabled, custom_name, custom_group,
                custom_logo_url, sort_order, match_locked, match_confidence,
                reconciliation_status, last_seen_at, updated_at
         FROM channel
         WHERE source_id = $1 AND id = $2 AND archived_at IS NULL
         FOR UPDATE`,
        [sourceId, channelId],
      );
      const target = targetResult.rows[0];
      if (!target) {
        await client.query('ROLLBACK');
        return null;
      }
      if (!['ambiguous', 'missing'].includes(target.reconciliation_status)) {
        throw new ManualMatchConflictError(
          'Only ambiguous or missing channels can be matched manually',
        );
      }

      const itemResult = await client.query<{
        id: string;
        provider_stream_id: string | null;
        tvg_id: string | null;
        provider_name: string;
        provider_group: string;
        provider_logo_url: string | null;
      }>(
        `SELECT i.id, i.provider_stream_id, i.tvg_id,
                i.original_name AS provider_name, i.provider_group,
                i.logo_url AS provider_logo_url
         FROM source_snapshot s
         JOIN upstream_item i ON i.snapshot_id = s.id
         LEFT JOIN group_policy p
           ON p.source_id = s.source_id AND p.provider_group = i.provider_group
         WHERE s.source_id = $1 AND s.is_last_known_good = TRUE
           AND i.id = $2 AND i.media_type = 'live'
           AND COALESCE(p.behavior, 'permanent') = 'permanent'
         FOR UPDATE OF i`,
        [sourceId, upstreamItemId],
      );
      const item = itemResult.rows[0];
      if (!item) {
        await client.query('ROLLBACK');
        return null;
      }

      const occupantResult = await client.query<
        ChannelRow & { current_upstream_item_id: string | null }
      >(
        `SELECT id, source_id, provider_name, provider_group, tvg_id,
                provider_logo_url, enabled, custom_name, custom_group,
                custom_logo_url, sort_order, match_locked, match_confidence,
                reconciliation_status, last_seen_at, updated_at,
                current_upstream_item_id
         FROM channel
         WHERE source_id = $1 AND current_upstream_item_id = $2
           AND archived_at IS NULL
         FOR UPDATE`,
        [sourceId, upstreamItemId],
      );
      const occupant = occupantResult.rows[0];
      let displacedChannelId: string | null = null;
      if (occupant && occupant.id !== channelId) {
        const isUntouchedNewChannel =
          occupant.reconciliation_status === 'new' &&
          occupant.enabled &&
          !occupant.custom_name &&
          !occupant.custom_group &&
          !occupant.custom_logo_url &&
          !occupant.match_locked;
        if (!isUntouchedNewChannel) {
          throw new ManualMatchConflictError(
            'The selected provider entry is already attached to an edited channel',
          );
        }
        displacedChannelId = occupant.id;
        await client.query(
          `UPDATE channel
           SET current_upstream_item_id = NULL, archived_at = NOW(),
               reconciliation_status = 'missing', updated_at = NOW()
           WHERE id = $1`,
          [occupant.id],
        );
      }

      const savedResult = await client.query<ChannelRow>(
        `UPDATE channel
         SET current_upstream_item_id = $3,
             provider_stream_id = $4,
             tvg_id = $5,
             provider_name = $6,
             provider_group = $7,
             provider_logo_url = $8,
             match_locked = TRUE,
             match_confidence = 1,
             reconciliation_status = 'matched',
             last_seen_at = NOW(),
             updated_at = NOW()
         WHERE source_id = $1 AND id = $2 AND archived_at IS NULL
         RETURNING id, source_id, provider_name, provider_group, tvg_id,
                   provider_logo_url, enabled, custom_name, custom_group,
                   custom_logo_url, sort_order, match_locked, match_confidence,
                   reconciliation_status, last_seen_at, updated_at`,
        [
          sourceId,
          channelId,
          item.id,
          item.provider_stream_id,
          item.tvg_id,
          item.provider_name,
          item.provider_group,
          item.provider_logo_url,
        ],
      );
      const saved = savedResult.rows[0];
      if (!saved) throw new Error('Manual channel match was not persisted');
      await this.#reconcileEpgMappings(client, sourceId);
      await client.query(
        `INSERT INTO channel_match_audit
          (source_id, channel_id, displaced_channel_id, upstream_item_id,
           action, details)
         VALUES ($1, $2, $3, $4, 'manual-match', $5::jsonb)`,
        [
          sourceId,
          channelId,
          displacedChannelId,
          upstreamItemId,
          JSON.stringify({
            previousProviderName: target.provider_name,
            providerName: item.provider_name,
            providerGroup: item.provider_group,
          }),
        ],
      );
      await client.query('COMMIT');
      return toChannelSummary(saved);
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async unlockChannelMatch(
    sourceId: string,
    channelId: string,
  ): Promise<ChannelSummary | null> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<
        ChannelRow & { current_upstream_item_id: string | null }
      >(
        `UPDATE channel
         SET match_locked = FALSE, updated_at = NOW()
         WHERE source_id = $1 AND id = $2 AND archived_at IS NULL
         RETURNING id, source_id, provider_name, provider_group, tvg_id,
                   provider_logo_url, enabled, custom_name, custom_group,
                   custom_logo_url, sort_order, match_locked, match_confidence,
                   reconciliation_status, last_seen_at, updated_at,
                   current_upstream_item_id`,
        [sourceId, channelId],
      );
      const channel = result.rows[0];
      if (!channel) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        `INSERT INTO channel_match_audit
          (source_id, channel_id, upstream_item_id, action)
         VALUES ($1, $2, $3, 'manual-unlock')`,
        [sourceId, channelId, channel.current_upstream_item_id],
      );
      await client.query('COMMIT');
      return toChannelSummary(channel);
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getEpgMappingReview(
    sourceId: string,
    search: string | undefined,
    limit: number,
  ): Promise<EpgMappingReview> {
    const { channels, guideChannels, lockedMappings, reconciliation } =
      await this.#loadEpgReconciliation(this.#pool, sourceId);
    const matchesByChannel = new Map(
      reconciliation.matches.map((match) => [match.channelId, match]),
    );
    const unresolvedByChannel = new Map(
      reconciliation.unresolved.map((item) => [item.channelId, item]),
    );
    const lockedIds = new Set(
      lockedMappings.map((mapping) => mapping.channelId),
    );
    const guideById = new Map(
      guideChannels.map((channel) => [channel.id, channel]),
    );
    const mappings: EpgMappingReviewItem[] = channels.map((channel) => {
      const match = matchesByChannel.get(channel.id);
      const unresolved = unresolvedByChannel.get(channel.id);
      const lockedId = unresolved?.lockedEpgChannelId;
      const lockedGuide = lockedId ? guideById.get(lockedId) : undefined;
      return {
        channelId: channel.id,
        channelName: channel.displayName,
        providerGroup: channel.providerGroup,
        ...(channel.tvgId ? { tvgId: channel.tvgId } : {}),
        status: match ? 'matched' : (unresolved?.status ?? 'missing'),
        manuallyLocked: lockedIds.has(channel.id),
        ...(match
          ? {
              epgChannelId: match.epgChannel.id,
              epgDisplayName: match.epgChannel.displayName,
              confidence: match.confidence,
            }
          : lockedId
            ? {
                epgChannelId: lockedId,
                ...(lockedGuide
                  ? { epgDisplayName: lockedGuide.displayName }
                  : {}),
              }
            : {}),
        candidateIds: unresolved?.candidateIds ?? [],
      };
    });
    const normalizedSearch = search?.trim().toLocaleLowerCase('en-US') ?? '';
    const visible = mappings
      .filter(
        (mapping) =>
          !normalizedSearch ||
          [
            mapping.channelName,
            mapping.providerGroup,
            mapping.tvgId ?? '',
            mapping.epgChannelId ?? '',
            mapping.epgDisplayName ?? '',
          ].some((value) =>
            value.toLocaleLowerCase('en-US').includes(normalizedSearch),
          ),
      )
      .sort(
        (left, right) =>
          Number(left.status === 'matched') -
            Number(right.status === 'matched') ||
          left.channelName.localeCompare(right.channelName),
      );
    return {
      mappings: visible.slice(0, limit),
      matchedCount: reconciliation.matches.length,
      missingCount: reconciliation.unresolved.filter(
        (item) => item.status === 'missing',
      ).length,
      ambiguousCount: reconciliation.unresolved.filter(
        (item) => item.status === 'ambiguous',
      ).length,
      manualCount: lockedMappings.length,
      total: channels.length,
      truncated: visible.length > limit,
    };
  }

  async searchEpgChannels(
    sourceId: string,
    search: string | undefined,
    limit: number,
  ): Promise<EpgGuideChannelPage> {
    const values: unknown[] = [sourceId];
    let filter = '';
    if (search) {
      values.push(`%${search}%`);
      filter = `AND (upstream_id ILIKE $${values.length}
                     OR display_name ILIKE $${values.length})`;
    }
    values.push(limit);
    const result = await this.#pool.query<{
      upstream_id: string;
      display_name: string;
      icon_url: string | null;
      total_count: string | number;
    }>(
      `SELECT upstream_id, display_name, icon_url, COUNT(*) OVER() AS total_count
       FROM epg_channel
       WHERE source_id = $1 ${filter}
       ORDER BY display_name, upstream_id
       LIMIT $${values.length}`,
      values,
    );
    const total = Number(result.rows[0]?.total_count ?? 0);
    return {
      channels: result.rows.map((row) => ({
        id: row.upstream_id,
        displayName: row.display_name,
        ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
      })),
      total,
      truncated: total > limit,
    };
  }

  async saveManualEpgMapping(
    sourceId: string,
    channelId: string,
    epgChannelId: string,
  ): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ channel_id: string }>(
        `SELECT c.id AS channel_id
         FROM channel c
         JOIN epg_channel guide
           ON guide.source_id = c.source_id AND guide.upstream_id = $3
         LEFT JOIN group_policy policy
           ON policy.source_id = c.source_id
          AND policy.provider_group = c.provider_group
         WHERE c.source_id = $1 AND c.id = $2 AND c.archived_at IS NULL
           AND COALESCE(policy.behavior, 'permanent') = 'permanent'
         FOR UPDATE OF c`,
        [sourceId, channelId, epgChannelId],
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO epg_mapping
          (channel_id, epg_channel_id, epg_channel_upstream_id, confidence,
           manually_locked)
         SELECT $2, guide.id, guide.upstream_id, 1, TRUE
         FROM epg_channel guide
         WHERE guide.source_id = $1 AND guide.upstream_id = $3
         ON CONFLICT (channel_id) DO UPDATE SET
           epg_channel_id = EXCLUDED.epg_channel_id,
           epg_channel_upstream_id = EXCLUDED.epg_channel_upstream_id,
           confidence = 1,
           manually_locked = TRUE,
           updated_at = NOW()`,
        [sourceId, channelId, epgChannelId],
      );
      await client.query(
        `INSERT INTO epg_mapping_audit
          (source_id, channel_id, epg_channel_upstream_id, action)
         VALUES ($1, $2, $3, 'manual-map')`,
        [sourceId, channelId, epgChannelId],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async unlockEpgMapping(
    sourceId: string,
    channelId: string,
  ): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const deleted = await client.query<{ epg_channel_upstream_id: string }>(
        `DELETE FROM epg_mapping mapping
         USING channel c
         WHERE mapping.channel_id = c.id
           AND c.source_id = $1 AND c.id = $2
           AND mapping.manually_locked = TRUE
         RETURNING mapping.epg_channel_upstream_id`,
        [sourceId, channelId],
      );
      const previous = deleted.rows[0];
      if (!previous) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO epg_mapping_audit
          (source_id, channel_id, epg_channel_upstream_id, action)
         VALUES ($1, $2, $3, 'manual-unlock')`,
        [sourceId, channelId, previous.epg_channel_upstream_id],
      );
      await this.#reconcileEpgMappings(client, sourceId);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listOutputGroupPolicies(
    sourceId: string,
    referenceDate: string,
  ): Promise<OutputGroupPolicy[]> {
    const result = await this.#pool.query<GroupRow>(
      `SELECT p.provider_group,
              0 AS channel_count,
              TRUE AS configured,
              p.behavior,
              p.enabled,
              p.output_group,
              p.hide_placeholders,
              p.placeholder_patterns,
              COALESCE(p.source_timezone, src.source_timezone) AS source_timezone,
              COALESCE(p.display_timezone, src.display_timezone) AS display_timezone,
              COALESCE(p.numeric_date_order, 'month-day') AS numeric_date_order
       FROM group_policy p
       JOIN source src ON src.id = p.source_id
       WHERE p.source_id = $1`,
      [sourceId],
    );
    return result.rows.map((row) => {
      const patterns = Array.isArray(row.placeholder_patterns)
        ? row.placeholder_patterns.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      return {
        behavior: row.behavior,
        groupName: row.provider_group,
        ...(row.output_group ? { outputGroupName: row.output_group } : {}),
        enabled: row.enabled,
        hidePlaceholders: row.hide_placeholders,
        ...(patterns.length > 0 ? { placeholderPatterns: patterns } : {}),
        ...(row.behavior === 'event'
          ? {
              timePolicy: {
                sourceTimeZone: row.source_timezone,
                displayTimeZone: row.display_timezone,
                numericDateOrder: row.numeric_date_order,
                referenceDate,
              },
            }
          : {}),
      };
    });
  }

  async createOutputProfile(
    sourceIds: string[],
    name: string,
  ): Promise<CreatedOutputProfile> {
    const uniqueSourceIds = [...new Set(sourceIds)];
    if (uniqueSourceIds.length === 0) {
      throw new Error('At least one provider is required for an output');
    }
    const accessToken = randomBytes(24).toString('base64url');
    const client = await this.#pool.connect();
    let profile: { id: string; name: string } | undefined;
    try {
      await client.query('BEGIN');
      const sourceResult = await client.query<{ id: string }>(
        `SELECT id FROM source WHERE id = ANY($1::uuid[])`,
        [uniqueSourceIds],
      );
      if (sourceResult.rows.length !== uniqueSourceIds.length) {
        throw new Error('One or more selected providers were not found');
      }
      const result = await client.query<{ id: string; name: string }>(
        `INSERT INTO output_profile (name, access_token_hash, configuration)
         VALUES ($1, $2, jsonb_build_object('sourceIds', $3::jsonb))
         RETURNING id, name`,
        [name, accessTokenHash(accessToken), JSON.stringify(uniqueSourceIds)],
      );
      profile = result.rows[0];
      await client.query('COMMIT');
    } catch (error) {
      await this.#safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
    if (!profile) throw new Error('Output profile insert did not return a row');
    return {
      id: profile.id,
      name: profile.name,
      accessToken,
      playlistPath: `/p/${accessToken}/playlist.m3u`,
      epgPath: `/p/${accessToken}/epg.xml`,
    };
  }

  async resolveOutputProfile(
    accessToken: string,
  ): Promise<ResolvedOutputProfile | null> {
    const result = await this.#pool.query<OutputProfileRow>(
      `SELECT id, name, configuration
       FROM output_profile
       WHERE access_token_hash = $1 AND enabled = TRUE`,
      [accessTokenHash(accessToken)],
    );
    const row = result.rows[0];
    if (!row) return null;
    const sourceIds = outputProfileSourceIds(row.configuration);
    return sourceIds.length > 0
      ? { id: row.id, name: row.name, sourceIds }
      : null;
  }

  async revokeOutputProfile(profileId: string): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE output_profile
       SET enabled = FALSE
       WHERE id = $1 AND enabled = TRUE`,
      [profileId],
    );
    return result.rowCount === 1;
  }

  #toSyncActivity(row: SyncRunHistoryRow): SourceActivityEvent {
    const summary =
      typeof row.summary === 'object' && row.summary !== null
        ? (row.summary as Record<string, unknown>)
        : {};
    const kind = row.sync_type === 'playlist' ? 'playlist-sync' : 'epg-sync';
    const label = row.sync_type === 'playlist' ? 'Playlist' : 'EPG';
    let detail = row.safe_error ?? `${label} refresh completed.`;
    if (row.status === 'succeeded') {
      if (summary.unchanged === true) {
        detail = `${label} data was unchanged.`;
      } else if (
        row.sync_type === 'playlist' &&
        typeof summary.liveCount === 'number'
      ) {
        detail = `${summary.liveCount.toLocaleString()} live entries accepted.`;
      } else if (
        row.sync_type === 'epg' &&
        typeof summary.programmeCount === 'number'
      ) {
        detail = `${summary.programmeCount.toLocaleString()} programmes accepted.`;
      }
    }
    return {
      id: row.id,
      kind,
      occurredAt: (row.finished_at ?? row.started_at).toISOString(),
      title: `${label} refresh ${row.status}`,
      detail,
      status: row.status,
    };
  }

  async #activateStoredSnapshot(
    client: PoolClient,
    sourceId: string,
    snapshotId: string,
    action: 'snapshot-activate' | 'snapshot-reactivate',
  ): Promise<void> {
    const currentResult = await client.query<{ id: string }>(
      `SELECT id
       FROM source_snapshot
       WHERE source_id = $1 AND is_last_known_good = TRUE
       FOR UPDATE`,
      [sourceId],
    );
    const fromSnapshotId = currentResult.rows[0]?.id ?? null;
    await client.query(
      'UPDATE source_snapshot SET is_last_known_good = FALSE WHERE source_id = $1',
      [sourceId],
    );
    const activated = await client.query(
      `UPDATE source_snapshot
       SET is_last_known_good = TRUE
       WHERE source_id = $1 AND id = $2`,
      [sourceId, snapshotId],
    );
    if (activated.rowCount !== 1) {
      throw new Error('Snapshot activation target disappeared');
    }
    await this.#reconcileChannels(client, sourceId, snapshotId);
    await client.query(
      `INSERT INTO source_audit_event
        (source_id, action, from_snapshot_id, to_snapshot_id, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        sourceId,
        action,
        fromSnapshotId,
        snapshotId,
        JSON.stringify({
          trigger: action === 'snapshot-activate' ? 'manual' : 'refresh',
        }),
      ],
    );
    await client.query('UPDATE source SET updated_at = NOW() WHERE id = $1', [
      sourceId,
    ]);
  }

  async #reconcileChannels(
    client: PoolClient,
    sourceId: string,
    snapshotId: string,
  ): Promise<void> {
    const existingResult = await client.query<{
      id: string;
      provider_stream_id: string | null;
      tvg_id: string | null;
      provider_name: string;
      provider_group: string;
      match_locked: boolean;
    }>(
      `SELECT c.id, c.provider_stream_id, c.tvg_id, c.provider_name,
              c.provider_group, c.match_locked
       FROM channel c
       LEFT JOIN group_policy p
         ON p.source_id = c.source_id AND p.provider_group = c.provider_group
       WHERE c.source_id = $1
         AND c.archived_at IS NULL
         AND COALESCE(p.behavior, 'permanent') = 'permanent'`,
      [sourceId],
    );
    const itemResult = await client.query<{
      id: string;
      provider_stream_id: string | null;
      tvg_id: string | null;
      provider_name: string;
      provider_group: string;
      provider_logo_url: string | null;
      sort_order: number;
    }>(
      `SELECT i.id, i.provider_stream_id, i.tvg_id,
              i.original_name AS provider_name, i.provider_group,
              i.logo_url AS provider_logo_url,
              COALESCE((i.metadata->>'lineNumber')::int, 0) AS sort_order
       FROM upstream_item i
       JOIN source_snapshot s ON s.id = i.snapshot_id
       LEFT JOIN group_policy p
         ON p.source_id = s.source_id AND p.provider_group = i.provider_group
       WHERE i.snapshot_id = $1 AND i.media_type = 'live'
         AND COALESCE(p.behavior, 'permanent') = 'permanent'
       ORDER BY sort_order, i.id`,
      [snapshotId],
    );
    const channels: ReconciliationChannel[] = existingResult.rows.map(
      (row) => ({
        id: row.id,
        providerStreamId: row.provider_stream_id,
        tvgId: row.tvg_id,
        providerName: row.provider_name,
        providerGroup: row.provider_group,
        matchLocked: row.match_locked,
      }),
    );
    const items: ReconciliationItem[] = itemResult.rows.map((row) => ({
      id: row.id,
      providerStreamId: row.provider_stream_id,
      tvgId: row.tvg_id,
      providerName: row.provider_name,
      providerGroup: row.provider_group,
      providerLogoUrl: row.provider_logo_url,
      sortOrder: row.sort_order,
    }));
    const reconciliation = reconcileChannels(channels, items);

    await client.query(
      `UPDATE channel
       SET current_upstream_item_id = NULL,
           reconciliation_status = 'missing',
           match_confidence = NULL,
           updated_at = NOW()
       WHERE source_id = $1 AND archived_at IS NULL`,
      [sourceId],
    );

    if (reconciliation.matches.length > 0) {
      const values = reconciliation.matches.map((match) => ({
        channel_id: match.channelId,
        item_id: match.item.id,
        provider_stream_id: match.item.providerStreamId,
        tvg_id: match.item.tvgId,
        provider_name: match.item.providerName,
        provider_group: match.item.providerGroup,
        provider_logo_url: match.item.providerLogoUrl,
        confidence: match.confidence,
      }));
      await client.query(
        `UPDATE channel c
         SET current_upstream_item_id = item.item_id::uuid,
             provider_stream_id = item.provider_stream_id,
             tvg_id = item.tvg_id,
             provider_name = item.provider_name,
             provider_group = item.provider_group,
             provider_logo_url = item.provider_logo_url,
             match_confidence = item.confidence,
             reconciliation_status = 'matched',
             last_seen_at = NOW(),
             updated_at = NOW()
         FROM jsonb_to_recordset($1::jsonb) AS item(
           channel_id UUID,
           item_id TEXT,
           provider_stream_id TEXT,
           tvg_id TEXT,
           provider_name TEXT,
           provider_group TEXT,
           provider_logo_url TEXT,
           confidence NUMERIC
         )
         WHERE c.id = item.channel_id`,
        [JSON.stringify(values)],
      );
    }

    if (reconciliation.ambiguousChannelIds.length > 0) {
      await client.query(
        `UPDATE channel
         SET reconciliation_status = 'ambiguous', updated_at = NOW()
         WHERE source_id = $1 AND id = ANY($2::uuid[])`,
        [sourceId, reconciliation.ambiguousChannelIds],
      );
    }

    if (reconciliation.newItems.length > 0) {
      const values = reconciliation.newItems.map((item) => ({
        item_id: item.id,
        provider_stream_id: item.providerStreamId,
        tvg_id: item.tvgId,
        provider_name: item.providerName,
        provider_group: item.providerGroup,
        provider_logo_url: item.providerLogoUrl,
        sort_order: item.sortOrder,
      }));
      await client.query(
        `INSERT INTO channel
          (source_id, current_upstream_item_id, provider_stream_id, tvg_id,
           provider_name, provider_group, provider_logo_url, sort_order,
           reconciliation_status, last_seen_at)
         SELECT $1, item.item_id::uuid, item.provider_stream_id, item.tvg_id,
                item.provider_name, item.provider_group, item.provider_logo_url,
                item.sort_order, 'new', NOW()
         FROM jsonb_to_recordset($2::jsonb) AS item(
           item_id TEXT,
           provider_stream_id TEXT,
           tvg_id TEXT,
           provider_name TEXT,
           provider_group TEXT,
           provider_logo_url TEXT,
           sort_order INTEGER
         )`,
        [sourceId, JSON.stringify(values)],
      );
    }

    await this.#reconcileEpgMappings(client, sourceId);
  }

  async #loadEpgReconciliation(
    client: Pool | PoolClient,
    sourceId: string,
  ): Promise<{
    channels: EpgPlaylistChannel[];
    guideChannels: EpgGuideChannel[];
    lockedMappings: LockedEpgMapping[];
    reconciliation: ReturnType<typeof reconcileEpgMappings>;
  }> {
    const channelResult = await client.query<{
      id: string;
      tvg_id: string | null;
      display_name: string;
      provider_group: string;
    }>(
      `SELECT c.id, c.tvg_id,
                COALESCE(c.custom_name, c.provider_name) AS display_name,
                COALESCE(c.custom_group, c.provider_group) AS provider_group
         FROM channel c
         LEFT JOIN group_policy policy
           ON policy.source_id = c.source_id
          AND policy.provider_group = c.provider_group
         WHERE c.source_id = $1 AND c.archived_at IS NULL
           AND c.enabled = TRUE AND c.current_upstream_item_id IS NOT NULL
           AND COALESCE(policy.behavior, 'permanent') = 'permanent'
         ORDER BY display_name, c.id`,
      [sourceId],
    );
    const guideResult = await client.query<{
      upstream_id: string;
      display_name: string;
    }>(
      `SELECT upstream_id, display_name
         FROM epg_channel
         WHERE source_id = $1 AND upstream_id IS NOT NULL
         ORDER BY display_name, upstream_id`,
      [sourceId],
    );
    const lockedResult = await client.query<{
      channel_id: string;
      epg_channel_upstream_id: string;
    }>(
      `SELECT mapping.channel_id, mapping.epg_channel_upstream_id
         FROM epg_mapping mapping
         JOIN channel c ON c.id = mapping.channel_id
         LEFT JOIN group_policy policy
           ON policy.source_id = c.source_id
          AND policy.provider_group = c.provider_group
         WHERE c.source_id = $1 AND mapping.manually_locked = TRUE
           AND c.archived_at IS NULL AND c.enabled = TRUE
           AND c.current_upstream_item_id IS NOT NULL
           AND COALESCE(policy.behavior, 'permanent') = 'permanent'`,
      [sourceId],
    );
    const channels: EpgPlaylistChannel[] = channelResult.rows.map((row) => ({
      id: row.id,
      tvgId: row.tvg_id,
      displayName: row.display_name,
      providerGroup: row.provider_group,
    }));
    const guideChannels: EpgGuideChannel[] = guideResult.rows.map((row) => ({
      id: row.upstream_id,
      displayName: row.display_name,
    }));
    const lockedMappings: LockedEpgMapping[] = lockedResult.rows.map((row) => ({
      channelId: row.channel_id,
      epgChannelId: row.epg_channel_upstream_id,
    }));
    return {
      channels,
      guideChannels,
      lockedMappings,
      reconciliation: reconcileEpgMappings(
        channels,
        guideChannels,
        lockedMappings,
      ),
    };
  }

  async #reconcileEpgMappings(
    client: PoolClient,
    sourceId: string,
  ): Promise<void> {
    const { reconciliation } = await this.#loadEpgReconciliation(
      client,
      sourceId,
    );
    await client.query(
      `DELETE FROM epg_mapping mapping
       USING channel c
       WHERE mapping.channel_id = c.id AND c.source_id = $1
         AND mapping.manually_locked = FALSE`,
      [sourceId],
    );
    await client.query(
      `UPDATE epg_mapping mapping
       SET epg_channel_id = NULL, updated_at = NOW()
       FROM channel c
       WHERE mapping.channel_id = c.id AND c.source_id = $1
         AND mapping.manually_locked = TRUE`,
      [sourceId],
    );
    await client.query(
      `UPDATE epg_mapping mapping
       SET epg_channel_id = guide.id, updated_at = NOW()
       FROM channel c, epg_channel guide
       WHERE mapping.channel_id = c.id AND c.source_id = $1
         AND mapping.manually_locked = TRUE
         AND guide.source_id = c.source_id
         AND guide.upstream_id = mapping.epg_channel_upstream_id`,
      [sourceId],
    );

    const automaticMatches = reconciliation.matches.filter(
      (match) => !match.manuallyLocked,
    );
    if (automaticMatches.length === 0) return;
    const values = automaticMatches.map((match) => ({
      channel_id: match.channelId,
      epg_channel_upstream_id: match.epgChannel.id,
      confidence: match.confidence,
    }));
    await client.query(
      `INSERT INTO epg_mapping
        (channel_id, epg_channel_id, epg_channel_upstream_id, confidence,
         manually_locked)
       SELECT item.channel_id, guide.id, item.epg_channel_upstream_id,
              item.confidence, FALSE
       FROM jsonb_to_recordset($2::jsonb) AS item(
         channel_id UUID,
         epg_channel_upstream_id TEXT,
         confidence NUMERIC
       )
       JOIN channel c ON c.id = item.channel_id AND c.source_id = $1
       JOIN epg_channel guide
         ON guide.source_id = c.source_id
        AND guide.upstream_id = item.epg_channel_upstream_id
       ON CONFLICT (channel_id) DO UPDATE SET
         epg_channel_id = EXCLUDED.epg_channel_id,
         epg_channel_upstream_id = EXCLUDED.epg_channel_upstream_id,
         confidence = EXCLUDED.confidence,
         manually_locked = FALSE,
         updated_at = NOW()`,
      [sourceId, JSON.stringify(values)],
    );
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  #decryptCredentials(encrypted: string): SourceCredentials {
    const value: unknown = JSON.parse(
      decryptSecret(encrypted, this.#masterKey),
    );
    if (
      typeof value !== 'object' ||
      value === null ||
      !('playlistUrl' in value) ||
      typeof value.playlistUrl !== 'string'
    ) {
      throw new Error('Stored source credential has an invalid shape');
    }

    const epgUrl =
      'epgUrl' in value && typeof value.epgUrl === 'string'
        ? value.epgUrl
        : undefined;
    return { playlistUrl: value.playlistUrl, ...(epgUrl ? { epgUrl } : {}) };
  }

  async #safeRollback(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original transaction error. The pool will discard a broken connection.
    }
  }
}
