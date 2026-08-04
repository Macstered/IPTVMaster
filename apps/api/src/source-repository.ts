import { decryptSecret, encryptSecret } from '@iptvmaster/core';
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

export interface SourceRepository {
  createSource(input: CreateSourceInput): Promise<SafeSource>;
  listSources(): Promise<SafeSource[]>;
  getSourceCredentials(sourceId: string): Promise<SourceCredentials | null>;
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
