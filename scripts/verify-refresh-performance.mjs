import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { runPostgresMigrations } from '../apps/api/dist/postgres-migrations.js';
import { PostgresSourceRepository } from '../apps/api/dist/source-repository.js';
import { retainedPlaylistFingerprint } from '../packages/core/dist/playlist-fingerprint.js';

// Deliberately refuse arbitrary databases. This fixture writes synthetic data
// and installs a delay trigger; never run it against a real installation.
const connectionString = process.env.REFRESH_TEST_DATABASE_URL;
assert.ok(
  connectionString,
  'Set REFRESH_TEST_DATABASE_URL for an isolated test database',
);
const target = new URL(connectionString);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
assert.equal(target.pathname, '/iptvmaster_refresh_test');
const pool = new Pool({ connectionString });
let repository;
try {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch {
      if (attempt >= 59)
        throw new Error('Synthetic PostgreSQL did not become ready');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const empty = await pool.query(
    "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'",
  );
  assert.equal(empty.rows[0].count, 0, 'Test database must be empty');
  await runPostgresMigrations({ connectionString, connectionAttempts: 3 });
  repository = new PostgresSourceRepository(
    connectionString,
    Buffer.alloc(32, 7).toString('base64'),
  );
  const source = await repository.createSource({
    name: 'Synthetic performance fixture',
    sourceType: 'm3u',
    credentials: {
      playlistUrl: 'https://fixture.test/get.php?username=demo&password=demo',
    },
    sourceTimezone: 'UTC',
    displayTimezone: 'UTC',
  });
  const entries = Array.from({ length: 2000 }, (_, index) => ({
    duration: -1,
    attributes: { 'group-title': 'Fixture TV', 'tvg-id': `tv-${index}` },
    name: `Fixture ${index}`,
    url: `https://fixture.test/live/demo/demo/${index + 1}.ts`,
    mediaType: 'live',
    lineNumber: index * 2 + 2,
  }));
  const inspection = {
    entries,
    fingerprint: retainedPlaylistFingerprint(entries),
    totalBytes: 100000,
    issues: [],
    skippedEntries: 1,
    mediaCounts: { live: entries.length, vod: 1, series: 0, unknown: 0 },
    categories: [
      { mediaType: 'vod', providerGroup: 'Unselected movies', itemCount: 1 },
    ],
  };
  // Statement-level trigger makes the transaction visibly longer than its
  // opening timestamp, without slowing every individual row.
  await pool.query(`CREATE FUNCTION fixture_import_delay() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.15); RETURN NULL; END $$;
    CREATE TRIGGER fixture_import_delay AFTER INSERT ON upstream_item
    FOR EACH STATEMENT EXECUTE FUNCTION fixture_import_delay();`);
  const stages = [];
  const started = performance.now();
  const first = await repository.savePlaylistSnapshot(
    source.id,
    inspection,
    (stage, processed, total) => stages.push({ stage, processed, total }),
  );
  const firstMs = performance.now() - started;
  assert.equal(first.unchanged, false);
  assert.ok(
    stages.some(
      (stage) => stage.stage === 'saving' && stage.processed === 1000,
    ),
  );
  assert.ok(
    stages.some(
      (stage) => stage.stage === 'saving' && stage.processed === 2000,
    ),
  );
  assert.equal(stages.at(-1).stage, 'committing');
  const timing = await pool.query(
    `SELECT extract(epoch FROM (finished_at-started_at))*1000 AS elapsed
    FROM sync_run WHERE source_id=$1 ORDER BY started_at DESC LIMIT 1`,
    [source.id],
  );
  assert.ok(
    Number(timing.rows[0].elapsed) >= 300,
    'Completion must include database work, not transaction start',
  );
  const channel = await pool.query(
    'SELECT id FROM channel WHERE source_id=$1 ORDER BY sort_order LIMIT 1',
    [source.id],
  );
  await pool.query(
    "UPDATE channel SET custom_name='My rename', enabled=false, sort_order=99 WHERE id=$1",
    [channel.rows[0].id],
  );

  const secondStarted = performance.now();
  const second = await repository.savePlaylistSnapshot(source.id, {
    ...inspection,
    categories: [
      { mediaType: 'vod', providerGroup: 'Unselected movies', itemCount: 2 },
    ],
  });
  const unchangedMs = performance.now() - secondStarted;
  assert.equal(second.id, first.id);
  assert.equal(second.unchanged, true);
  const retained = await pool.query(
    'SELECT count(*)::int AS count FROM upstream_item',
  );
  assert.equal(
    retained.rows[0].count,
    entries.length,
    'Unselected changes must not write another full snapshot',
  );
  const category = await pool.query(
    'SELECT item_count FROM vod_category WHERE source_id=$1',
    [source.id],
  );
  assert.equal(
    category.rows[0].item_count,
    2,
    'Category discovery must still refresh',
  );

  entries[0] = { ...entries[0], name: 'Provider rename' };
  const third = await repository.savePlaylistSnapshot(source.id, {
    ...inspection,
    fingerprint: retainedPlaylistFingerprint(entries),
  });
  assert.equal(third.unchanged, false);
  const preserved = await pool.query(
    'SELECT custom_name,enabled,sort_order FROM channel WHERE id=$1',
    [channel.rows[0].id],
  );
  assert.deepEqual(preserved.rows[0], {
    custom_name: 'My rename',
    enabled: false,
    sort_order: 99,
  });
  await repository.activateSnapshot(source.id, first.id);
  const restored = await pool.query(
    'SELECT custom_name,enabled,sort_order FROM channel WHERE id=$1',
    [channel.rows[0].id],
  );
  assert.deepEqual(
    restored.rows[0],
    preserved.rows[0],
    'Restore must retain user overrides',
  );
  const epgStartedAt = new Date(Date.now() - 500).toISOString();
  const epgProgress = [];
  await repository.saveEpgSnapshot(
    source.id,
    {
      fingerprint: 'e'.repeat(64),
      totalBytes: 10,
      issues: [],
      issuesTruncated: false,
      channels: [{ id: 'tv-1', displayName: 'Fixture guide' }],
      programmes: [
        {
          channelId: 'tv-1',
          start: '2026-09-23T00:00:00.000Z',
          title: 'Synthetic show',
        },
      ],
    },
    (stage) => epgProgress.push(stage),
    epgStartedAt,
  );
  const epgTiming = await pool.query(
    `SELECT started_at, extract(epoch FROM (finished_at-started_at))*1000 AS elapsed
    FROM sync_run WHERE source_id=$1 AND sync_type='epg' ORDER BY started_at DESC LIMIT 1`,
    [source.id],
  );
  assert.equal(epgTiming.rows[0].started_at.toISOString(), epgStartedAt);
  assert.ok(
    Number(epgTiming.rows[0].elapsed) >= 500,
    'EPG history includes queue/download time',
  );
  assert.equal(epgProgress.at(-1), 'committing');
  const output = await repository.createOutputProfile(
    [source.id],
    'Fixture output',
    ['live'],
  );
  await pool.query('UPDATE vod_category SET enabled=TRUE WHERE source_id=$1', [
    source.id,
  ]);
  const savedCredentials = await repository.getSourceCredentials(source.id);
  const switched = await repository.updateSource(source.id, {
    name: source.name,
    sourceType: 'xtream',
    sourceTimezone: 'UTC',
    displayTimezone: 'UTC',
  });
  assert.equal(switched.id, source.id);
  assert.equal(switched.sourceType, 'xtream');
  const switchedChannel = await pool.query(
    'SELECT custom_name,enabled,sort_order FROM channel WHERE id=$1',
    [channel.rows[0].id],
  );
  assert.deepEqual(switchedChannel.rows[0], preserved.rows[0]);
  assert.ok(
    (await repository.listOutputProfiles()).some(
      (profile) => profile.id === output.id,
    ),
    'Switch keeps existing player links',
  );
  const chosenCategories = await pool.query(
    'SELECT count(*)::int AS count FROM vod_category WHERE source_id=$1',
    [source.id],
  );
  assert.equal(
    chosenCategories.rows[0].count,
    1,
    'Switch preserves category settings',
  );
  assert.deepEqual(
    await repository.getSourceCredentials(source.id),
    savedCredentials,
  );
  assert.ok(
    (await repository.getImportPlan(source.id)).selectiveGroups.size > 0,
  );
  assert.ok(
    await repository.resolveOutputProfile(output.accessToken),
    'Original player token remains valid',
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      syntheticChannels: entries.length,
      changedImportMs: Math.round(firstMs),
      unchangedImportMs: Math.round(unchangedMs),
      verified: [
        'wall-clock history',
        'batch progress',
        'no duplicate unchanged rows',
        'category discovery',
        'channel overrides',
        'snapshot restore',
      ],
    }),
  );
} finally {
  await repository?.close();
  await pool.end();
}
