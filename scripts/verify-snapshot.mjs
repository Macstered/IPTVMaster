const repositoryModule =
  process.env.SNAPSHOT_REPOSITORY_MODULE ??
  new URL('../apps/api/dist/source-repository.js', import.meta.url).href;
const { PostgresSourceRepository } = await import(repositoryModule);
const { applyOutputGroupPolicies, serializeM3u } = await import(
  new URL('../packages/core/dist/index.js', import.meta.url).href
);

const connectionString = process.env.DATABASE_URL;
const masterKey = process.env.IPTVMASTER_MASTER_KEY;
const integrationBaseUrl = process.env.IPTVMASTER_INTEGRATION_BASE_URL;
if (!connectionString || !masterKey) {
  throw new Error('DATABASE_URL and IPTVMASTER_MASTER_KEY are required');
}

const repository = new PostgresSourceRepository(connectionString, masterKey);
try {
  const source =
    (await repository.listSources())[0] ??
    (await repository.createSource({
      name: 'Synthetic integration source',
      sourceType: 'm3u',
      credentials: {
        playlistUrl: 'http://provider.test/synthetic-playlist',
      },
      sourceTimezone: 'Europe/Stockholm',
      displayTimezone: 'Europe/Helsinki',
    }));

  const streamUrl = 'http://provider.test/synthetic-stream/42';
  const inspection = {
    fingerprint: 'c'.repeat(64),
    totalBytes: 360,
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
      {
        duration: -1,
        attributes: {
          'tvg-name': '17:00 Tennis 8/4',
          'group-title': 'Synthetic Events FI',
        },
        name: '17:00 Tennis 8/4',
        url: 'http://provider.test/synthetic-stream/43',
        mediaType: 'live',
        lineNumber: 4,
      },
      {
        duration: -1,
        attributes: {
          'tvg-name': 'Reload your playlist',
          'group-title': 'Synthetic Events FI',
        },
        name: 'Reload your playlist',
        url: 'http://provider.test/synthetic-stream/44',
        mediaType: 'live',
        lineNumber: 6,
      },
    ],
    issues: [],
    mediaCounts: { live: 3, vod: 0, series: 0, unknown: 0 },
    skippedEntries: 0,
  };

  const first = await repository.savePlaylistSnapshot(source.id, inspection);
  const second = await repository.savePlaylistSnapshot(source.id, inspection);
  const entries = await repository.getLatestPlaylistEntries(source.id);
  const groups = await repository.listGroups(source.id);
  await repository.saveGroupPolicy(source.id, {
    groupName: 'Synthetic Events FI',
    behavior: 'event',
    enabled: true,
    outputGroupName: 'Localized events',
    hidePlaceholders: true,
    sourceTimeZone: 'Europe/Stockholm',
    displayTimeZone: 'Europe/Helsinki',
    numericDateOrder: 'month-day',
  });
  const policies = await repository.listOutputGroupPolicies(
    source.id,
    '2026-08-04',
  );
  const output = serializeM3u(
    applyOutputGroupPolicies(entries, policies).entries,
  );
  const profile = await repository.createOutputProfile(
    source.id,
    'Synthetic TiviMate',
  );
  const resolvedProfile = await repository.resolveOutputProfile(
    profile.accessToken,
  );
  const publishedResponse = integrationBaseUrl
    ? await fetch(`${integrationBaseUrl}${profile.playlistPath}`)
    : undefined;
  const publishedOutput = publishedResponse
    ? await publishedResponse.text()
    : output;
  const revoked = await repository.revokeOutputProfile(profile.id);
  const revokedProfile = await repository.resolveOutputProfile(
    profile.accessToken,
  );
  const report = {
    firstUnchanged: first.unchanged,
    secondUnchanged: second.unchanged,
    entryCount: entries.length,
    streamUrlRoundTrip: entries[0]?.url === streamUrl,
    groupCount: groups.length,
    outputLocalized: output.includes('18:00 Tennis 8/4'),
    outputPlaceholderHidden: !output.includes('Reload your playlist'),
    outputGroupRenamed: output.includes('group-title="Localized events"'),
    outputTokenResolves: resolvedProfile?.sourceId === source.id,
    publishedEndpointOk:
      publishedResponse === undefined ||
      (publishedResponse.ok && publishedOutput.includes('18:00 Tennis 8/4')),
    outputTokenRevoked: revoked && revokedProfile === null,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (
    !report.secondUnchanged ||
    report.entryCount !== 3 ||
    report.groupCount !== 2 ||
    !report.streamUrlRoundTrip ||
    !report.outputLocalized ||
    !report.outputPlaceholderHidden ||
    !report.outputGroupRenamed ||
    !report.outputTokenResolves ||
    !report.publishedEndpointOk ||
    !report.outputTokenRevoked
  ) {
    throw new Error('Synthetic PostgreSQL integration verification failed');
  }
} finally {
  await repository.close();
}
