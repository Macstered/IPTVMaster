import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Pool, PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PostgresMigrationError,
  runPostgresMigrations,
} from './postgres-migrations.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function memoryPool() {
  const checksums = new Map<string, string>();
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      statements.push({ text, values });
      if (text.startsWith('SELECT checksum FROM schema_migration')) {
        const checksum = checksums.get(String(values[0]));
        return { rows: checksum === undefined ? [] : [{ checksum }] };
      }
      if (text.startsWith('INSERT INTO schema_migration')) {
        checksums.set(String(values[0]), String(values[1]));
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client as unknown as PoolClient),
    end: vi.fn(async () => undefined),
  } as unknown as Pick<Pool, 'connect' | 'end'>;
  return { checksums, client, pool, statements };
}

async function migrationDirectory(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'iptvmaster-migrations-'));
  temporaryDirectories.push(directory);
  await Promise.all(
    Object.entries(files).map(([name, sql]) =>
      writeFile(join(directory, name), sql, 'utf8'),
    ),
  );
  return directory;
}

describe('PostgreSQL startup migrations', () => {
  it('applies migrations in order under a database lock', async () => {
    const directory = await migrationDirectory({
      '002_second.sql': 'CREATE TABLE second_table (id INTEGER);',
      '001_first.sql': 'CREATE TABLE first_table (id INTEGER);',
    });
    const database = memoryPool();

    const result = await runPostgresMigrations({
      migrationsDirectory: directory,
      pool: database.pool,
    });

    expect(result).toEqual({ applied: 2, total: 2 });
    const sql = database.statements.map((statement) => statement.text);
    expect(sql.indexOf('CREATE TABLE first_table (id INTEGER);')).toBeLessThan(
      sql.indexOf('CREATE TABLE second_table (id INTEGER);'),
    );
    expect(sql[0]).toContain('pg_advisory_lock');
    expect(sql.at(-1)).toContain('pg_advisory_unlock');
    expect(database.client.release).toHaveBeenCalledOnce();
  });

  it('is idempotent and refuses a changed applied migration', async () => {
    const directory = await migrationDirectory({
      '001_initial.sql': 'CREATE TABLE example (id INTEGER);',
    });
    const database = memoryPool();

    await expect(
      runPostgresMigrations({
        migrationsDirectory: directory,
        pool: database.pool,
      }),
    ).resolves.toEqual({ applied: 1, total: 1 });
    await expect(
      runPostgresMigrations({
        migrationsDirectory: directory,
        pool: database.pool,
      }),
    ).resolves.toEqual({ applied: 0, total: 1 });

    await writeFile(
      join(directory, '001_initial.sql'),
      'CREATE TABLE changed (id INTEGER);',
      'utf8',
    );
    await expect(
      runPostgresMigrations({
        migrationsDirectory: directory,
        pool: database.pool,
      }),
    ).rejects.toThrow('Checksum mismatch for applied migration 001_initial');
  });

  it('retries database startup without exposing connection errors', async () => {
    const directory = await migrationDirectory({
      '001_initial.sql': 'SELECT 1;',
    });
    const database = memoryPool();
    const connect = vi
      .fn<() => Promise<PoolClient>>()
      .mockRejectedValueOnce(new Error('contains-a-secret'))
      .mockRejectedValueOnce(new Error('contains-a-secret'))
      .mockResolvedValue(database.client as unknown as PoolClient);
    const pool = {
      connect,
      end: vi.fn(async () => undefined),
    } as unknown as Pick<Pool, 'connect' | 'end'>;

    await expect(
      runPostgresMigrations({
        migrationsDirectory: directory,
        pool,
        connectionAttempts: 3,
        retryDelayMs: 0,
      }),
    ).resolves.toEqual({ applied: 1, total: 1 });
    expect(connect).toHaveBeenCalledTimes(3);

    await expect(
      runPostgresMigrations({
        migrationsDirectory: directory,
        pool: {
          connect: vi.fn(async () => {
            throw new Error('contains-a-secret');
          }),
          end: vi.fn(async () => undefined),
        } as unknown as Pick<Pool, 'connect' | 'end'>,
        connectionAttempts: 1,
        retryDelayMs: 0,
      }),
    ).rejects.toEqual(
      new PostgresMigrationError(
        'PostgreSQL did not become ready before startup timed out',
      ),
    );
  });

  it('bundles the administrator schema needed by a clean install', async () => {
    const database = memoryPool();

    const result = await runPostgresMigrations({ pool: database.pool });

    expect(result.total).toBeGreaterThanOrEqual(19);
    expect(
      database.statements.some((statement) =>
        statement.text.includes('CREATE TABLE admin_account'),
      ),
    ).toBe(true);
  });
});
