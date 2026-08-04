import {
  decryptSecret,
  encryptSecret,
  SnapshotRejectedError,
  validateSnapshotCandidate,
  type M3uEntry,
  type PlaylistInspection,
} from '@iptvmaster/core';
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

export interface SourceRepository {
  createSource(input: CreateSourceInput): Promise<SafeSource>;
  listSources(): Promise<SafeSource[]>;
  getSourceCredentials(sourceId: string): Promise<SourceCredentials | null>;
  savePlaylistSnapshot(
    sourceId: string,
    inspection: PlaylistInspection,
  ): Promise<StoredSnapshotSummary>;
  getLatestPlaylistEntries(sourceId: string): Promise<M3uEntry[]>;
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
