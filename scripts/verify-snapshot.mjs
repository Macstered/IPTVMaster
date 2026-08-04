const repositoryModule =
  process.env.SNAPSHOT_REPOSITORY_MODULE ??
  new URL('../apps/api/dist/source-repository.js', import.meta.url).href;
const { PostgresSourceRepository } = await import(repositoryModule);

const connectionString = process.env.DATABASE_URL;
const masterKey = process.env.IPTVMASTER_MASTER_KEY;
if (!connectionString || !masterKey) {
  throw new Error('DATABASE_URL and IPTVMASTER_MASTER_KEY are required');
}

const repository = new PostgresSourceRepository(connectionString, masterKey);
try {
  const source = (await repository.listSources())[0];
  if (!source) throw new Error('Create a synthetic source before verification');

  const streamUrl = 'http://provider.test/synthetic-user/synthetic-secret/42';
  const inspection = {
    fingerprint: 'c'.repeat(64),
    totalBytes: 120,
    entries: [
      {
        duration: -1,
        attributes: {
          'tvg-name': 'Yle TV1',
          'group-title': 'Finland',
        },
        name: 'Yle TV1',
        url: streamUrl,
        mediaType: 'live',
        lineNumber: 2,
      },
    ],
    issues: [],
    mediaCounts: { live: 1, vod: 0, series: 0, unknown: 0 },
    skippedEntries: 0,
  };

  const first = await repository.savePlaylistSnapshot(source.id, inspection);
  const second = await repository.savePlaylistSnapshot(source.id, inspection);
  const entries = await repository.getLatestPlaylistEntries(source.id);
  process.stdout.write(
    `${JSON.stringify({
      firstUnchanged: first.unchanged,
      secondUnchanged: second.unchanged,
      entryCount: entries.length,
      streamUrlRoundTrip: entries[0]?.url === streamUrl,
    })}\n`,
  );
} finally {
  await repository.close();
}
