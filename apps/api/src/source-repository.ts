import {
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
  sourceId: string;
}

export interface SourceRepository {
  createSource(input: CreateSourceInput): Promise<SafeSource>;
  listSources(): Promise<SafeSource[]>;
  getSourceCredentials(sourceId: string): Promise<SourceCredentials | null>;
  savePlaylistSnapshot(
    sourceId: string,
    inspection: PlaylistInspection,
  ): Promise<StoredSnapshotSummary>;
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
  listOutputGroupPolicies(
    sourceId: string,
    referenceDate: string,
  ): Promise<OutputGroupPolicy[]>;
  createOutputProfile(
    sourceId: string,
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

interface OutputProfileRow {
  id: string;
  name: string;
  source_id: string;
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

function toGroupSummary(row: GroupRow): GroupSummary {
  return {
    providerGroup: row.provider_group,
    channelCount: Number(row.channel_count),
    configured: row.configured,
    behavior: row.behavior,
    enabled: row.enabled,
    ...(row.output_group ? { outputGroupName: row.output_group } : {}),
    hidePlaceholders: row.hide_placeholders,
    sourceTimeZone: row.source_timezone,
    displayTimeZone: row.display_timezone,
    numericDateOrder: row.numeric_date_order,
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

      const existing = await client.query<SnapshotRow>(
        `SELECT id, source_id, fingerprint, imported_at, live_count,
                skipped_vod_count, issue_count
         FROM source_snapshot
         WHERE source_id = $1 AND fingerprint = $2`,
        [sourceId, inspection.fingerprint],
      );
      if (existing.rows[0]) {
        const summary = toSnapshotSummary(existing.rows[0], true);
        await client.query(
          `UPDATE sync_run
           SET status = 'succeeded', finished_at = NOW(), summary = $2::jsonb
           WHERE id = $1`,
          [syncRunId, JSON.stringify(summary)],
        );
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

      await client.query('BEGIN');
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

  async getLatestPlaylistEntries(sourceId: string): Promise<M3uEntry[]> {
    const result = await this.#pool.query<StoredEntryRow>(
      `SELECT i.original_name, i.encrypted_stream_url, i.media_type, i.metadata
       FROM source_snapshot s
       JOIN upstream_item i ON i.snapshot_id = s.id
       WHERE s.source_id = $1 AND s.is_last_known_good = TRUE
       ORDER BY COALESCE((i.metadata->>'lineNumber')::int, 0), i.id`,
      [sourceId],
    );
    return result.rows.map((row) => ({
      duration: row.metadata.duration ?? null,
      attributes: row.metadata.attributes ?? {},
      name: row.original_name,
      url: decryptSecret(row.encrypted_stream_url, this.#masterKey),
      mediaType: row.media_type,
      lineNumber: row.metadata.lineNumber ?? 0,
    }));
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
    await this.#pool.query(
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
    const group = (await this.listGroups(sourceId)).find(
      (candidate) => candidate.providerGroup === input.groupName,
    );
    if (!group)
      throw new Error('Saved group policy does not match a current group');
    return group;
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
    sourceId: string,
    name: string,
  ): Promise<CreatedOutputProfile> {
    const accessToken = randomBytes(24).toString('base64url');
    const result = await this.#pool.query<{ id: string; name: string }>(
      `INSERT INTO output_profile (name, access_token_hash, configuration)
       SELECT $2, $3, jsonb_build_object('sourceId', s.id)
       FROM source s
       WHERE s.id = $1
       RETURNING id, name`,
      [sourceId, name, accessTokenHash(accessToken)],
    );
    const profile = result.rows[0];
    if (!profile)
      throw new Error('Source not found while creating output profile');
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
      `SELECT id, name, configuration->>'sourceId' AS source_id
       FROM output_profile
       WHERE access_token_hash = $1 AND enabled = TRUE`,
      [accessTokenHash(accessToken)],
    );
    const row = result.rows[0];
    return row ? { id: row.id, name: row.name, sourceId: row.source_id } : null;
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
