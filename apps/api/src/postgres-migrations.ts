import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient } from 'pg';

const MIGRATION_NAME = /^\d{3}_[A-Za-z0-9_]+\.sql$/;
const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../../../deploy/postgres/init/', import.meta.url),
);

export interface PostgresMigrationResult {
  applied: number;
  total: number;
}

export interface PostgresMigrationOptions {
  connectionString?: string;
  migrationsDirectory?: string;
  connectionAttempts?: number;
  retryDelayMs?: number;
  pool?: Pick<Pool, 'connect' | 'end'>;
  onMigration?: (message: string) => void;
}

interface Migration {
  checksum: string;
  name: string;
  sql: string;
}

export class PostgresMigrationError extends Error {
  override readonly name = 'PostgresMigrationError';
}

async function loadMigrations(directory: string): Promise<Migration[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new PostgresMigrationError(
      'Bundled PostgreSQL migrations could not be read',
    );
  }
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    throw new PostgresMigrationError(
      'No PostgreSQL migrations are bundled with this image',
    );
  }
  for (const name of names) {
    if (!MIGRATION_NAME.test(name)) {
      throw new PostgresMigrationError(
        `Invalid PostgreSQL migration filename: ${name}`,
      );
    }
  }
  try {
    return await Promise.all(
      names.map(async (filename) => {
        const sql = await readFile(join(directory, filename), 'utf8');
        return {
          name: filename.slice(0, -4),
          sql,
          checksum: createHash('sha256').update(sql).digest('hex'),
        };
      }),
    );
  } catch {
    throw new PostgresMigrationError(
      'Bundled PostgreSQL migrations could not be read',
    );
  }
}

async function connectWithRetry(
  pool: Pick<Pool, 'connect'>,
  attempts: number,
  retryDelayMs: number,
): Promise<PoolClient> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await pool.connect();
    } catch {
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new PostgresMigrationError(
    'PostgreSQL did not become ready before startup timed out',
  );
}

export async function runPostgresMigrations(
  options: PostgresMigrationOptions = {},
): Promise<PostgresMigrationResult> {
  const connectionString =
    options.connectionString ?? process.env['DATABASE_URL'];
  if (!connectionString && !options.pool) {
    throw new PostgresMigrationError(
      'DATABASE_URL is required to prepare PostgreSQL',
    );
  }
  const migrations = await loadMigrations(
    options.migrationsDirectory ??
      process.env['IPTVMASTER_MIGRATIONS_DIR'] ??
      DEFAULT_MIGRATIONS_DIRECTORY,
  );
  const ownedPool = options.pool
    ? null
    : new Pool({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 2_000,
      });
  const pool = options.pool ?? ownedPool;
  if (!pool) {
    throw new PostgresMigrationError(
      'PostgreSQL migration pool is unavailable',
    );
  }
  // Crash recovery after an unclean shutdown can hold connections off for
  // minutes on slow storage. Waiting five minutes by default (150 x 2 s) rides
  // that out instead of exiting and letting the container restart loop.
  const attempts = Math.max(1, options.connectionAttempts ?? 150);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 2_000);
  let client: PoolClient | null = null;
  let applied = 0;
  try {
    client = await connectWithRetry(pool, attempts, retryDelayMs);
    await client.query(
      "SELECT pg_advisory_lock(hashtext('iptvmaster-schema-migrations'))",
    );
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    for (const migration of migrations) {
      const stored = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migration WHERE version = $1',
        [migration.name],
      );
      const checksum = stored.rows[0]?.checksum;
      if (checksum !== undefined) {
        if (checksum !== migration.checksum) {
          throw new PostgresMigrationError(
            `Checksum mismatch for applied migration ${migration.name}`,
          );
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migration (version, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
        throw new PostgresMigrationError(
          `Failed to apply PostgreSQL migration ${migration.name}`,
        );
      }
      applied += 1;
      options.onMigration?.(`Applied PostgreSQL migration ${migration.name}`);
    }
    return { applied, total: migrations.length };
  } catch (error) {
    if (error instanceof PostgresMigrationError) throw error;
    throw new PostgresMigrationError('PostgreSQL schema verification failed');
  } finally {
    if (client) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('iptvmaster-schema-migrations'))",
        );
      } catch {
        // The original failure is more useful than a cleanup error.
      }
      client.release();
    }
    if (ownedPool) await ownedPool.end();
  }
}
