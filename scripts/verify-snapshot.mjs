const repositoryModule =
  process.env.SNAPSHOT_REPOSITORY_MODULE ??
  new URL('../apps/api/dist/source-repository.js', import.meta.url).href;
const coreModule =
  process.env.SNAPSHOT_CORE_MODULE ??
  new URL('../packages/core/dist/index.js', import.meta.url).href;
const { PostgresSourceRepository } = await import(repositoryModule);
const { applyOutputGroupPolicies, serializeM3u } = await import(coreModule);

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
          'tvg-name': '20:00 Late final 8/4',
          'group-title': 'Synthetic Events FI',
        },
        name: '20:00 Late final 8/4',
        url: 'http://provider.test/synthetic-stream/45',
        mediaType: 'live',
        lineNumber: 4,
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
        lineNumber: 6,
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
        lineNumber: 8,
      },
    ],
    issues: [],
    mediaCounts: { live: 4, vod: 0, series: 0, unknown: 0 },
    skippedEntries: 0,
  };

  const first = await repository.savePlaylistSnapshot(source.id, inspection);
  const second = await repository.savePlaylistSnapshot(source.id, inspection);
  const channelPage = await repository.listChannels(source.id, {
    search: 'Yle TV1',
    limit: 20,
    offset: 0,
  });
  const yleChannel = channelPage.channels[0];
  if (!yleChannel) throw new Error('Synthetic channel reconciliation failed');
  await repository.updateChannel(source.id, yleChannel.id, {
    customName: 'Yle One',
    customGroup: 'Finnish favourites',
    customLogoUrl: 'https://images.test/yle-one.png',
    sortOrder: 1,
  });
  const refreshedInspection = {
    ...inspection,
    fingerprint: 'd'.repeat(64),
    entries: inspection.entries.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            name: 'Yle TV1 HD',
            attributes: { ...entry.attributes, 'tvg-name': 'Yle TV1 HD' },
          }
        : entry,
    ),
  };
  const changedSnapshot = await repository.savePlaylistSnapshot(
    source.id,
    refreshedInspection,
  );
  const reconciledChannels = await repository.listChannels(source.id, {
    search: 'Yle One',
    limit: 20,
    offset: 0,
  });
  const reviewStreamUrl = 'http://provider.test/synthetic-stream/99';
  const reviewInspection = {
    ...refreshedInspection,
    fingerprint: 'f'.repeat(64),
    entries: refreshedInspection.entries.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            name: 'Yle News HD',
            url: reviewStreamUrl,
            attributes: {
              ...entry.attributes,
              'tvg-id': 'yle-news.fi',
              'tvg-name': 'Yle News HD',
            },
          }
        : entry,
    ),
  };
  const reviewSnapshot = await repository.savePlaylistSnapshot(
    source.id,
    reviewInspection,
  );
  const reviewBefore = await repository.getReconciliationReview(
    source.id,
    'Yle One',
    100,
  );
  const reviewChannel = reviewBefore.unresolvedChannels.find(
    (channel) => channel.id === yleChannel.id,
  );
  const reviewCandidate = reviewBefore.candidates.find(
    (candidate) => candidate.providerName === 'Yle News HD',
  );
  if (!reviewChannel || !reviewCandidate) {
    throw new Error('Synthetic channel review setup failed');
  }
  const manualResolved = await repository.resolveChannelMatch(
    source.id,
    reviewChannel.id,
    reviewCandidate.upstreamItemId,
  );
  const bulkHidden = await repository.bulkUpdateChannels(
    source.id,
    [reviewChannel.id],
    { enabled: false, customGroup: 'Bulk favourites' },
  );
  const hiddenEntries = await repository.getLatestPlaylistEntries(source.id);
  const bulkRestored = await repository.bulkUpdateChannels(
    source.id,
    [reviewChannel.id],
    { enabled: true, customGroup: 'Finnish favourites' },
  );
  const unlocked = await repository.unlockChannelMatch(
    source.id,
    reviewChannel.id,
  );
  const reviewAfter = await repository.getReconciliationReview(
    source.id,
    undefined,
    100,
  );
  const activeResolvedChannels = await repository.listChannels(source.id, {
    search: 'Yle One',
    limit: 20,
    offset: 0,
  });
  const historyBeforeRestore = await repository.listSourceHistory(
    source.id,
    20,
  );
  const restoredSnapshot = await repository.activateSnapshot(
    source.id,
    first.id,
  );
  const restoredEntries = await repository.getLatestPlaylistEntries(source.id);
  const historyAfterRestore = await repository.listSourceHistory(source.id, 20);
  const reactivatedSnapshot = await repository.savePlaylistSnapshot(
    source.id,
    reviewInspection,
  );
  const entries = await repository.getLatestPlaylistEntries(source.id);
  const historyAfterReactivate = await repository.listSourceHistory(
    source.id,
    20,
  );
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
  const epgInspection = {
    fingerprint: 'e'.repeat(64),
    totalBytes: 240,
    channels: [{ id: 'synthetic.yle1', displayName: 'Yle TV1' }],
    programmes: [
      {
        channelId: 'synthetic.yle1',
        start: '2026-08-04T15:00:00.000Z',
        stop: '2026-08-04T16:00:00.000Z',
        title: 'Synthetic news',
      },
    ],
    issues: [],
    issuesTruncated: false,
  };
  const firstEpg = await repository.saveEpgSnapshot(source.id, epgInspection);
  const epgReviewBefore = await repository.getEpgMappingReview(
    source.id,
    undefined,
    100,
  );
  const manualEpgSaved = await repository.saveManualEpgMapping(
    source.id,
    reviewChannel.id,
    'synthetic.yle1',
  );
  const mappedEntries = await repository.getLatestPlaylistEntries(source.id);
  const secondEpg = await repository.saveEpgSnapshot(source.id, epgInspection);
  const refreshedEpg = await repository.saveEpgSnapshot(source.id, {
    ...epgInspection,
    fingerprint: '9'.repeat(64),
  });
  const epgReviewAfterRefresh = await repository.getEpgMappingReview(
    source.id,
    undefined,
    100,
  );
  const guide = await repository.getLatestEpg(source.id);
  const profile = await repository.createOutputProfile(
    source.id,
    'Synthetic output',
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
  const publishedEpgResponse = integrationBaseUrl
    ? await fetch(`${integrationBaseUrl}${profile.epgPath}`)
    : undefined;
  const publishedEpg = publishedEpgResponse
    ? await publishedEpgResponse.text()
    : '';
  const epgHistory = await repository.listSourceHistory(source.id, 50);
  const manualEpgUnlocked = await repository.unlockEpgMapping(
    source.id,
    reviewChannel.id,
  );
  const epgReviewAfterUnlock = await repository.getEpgMappingReview(
    source.id,
    undefined,
    100,
  );
  const revoked = await repository.revokeOutputProfile(profile.id);
  const revokedProfile = await repository.resolveOutputProfile(
    profile.accessToken,
  );
  const report = {
    firstUnchanged: first.unchanged,
    secondUnchanged: second.unchanged,
    changedSnapshotImported: !changedSnapshot.unchanged,
    entryCount: entries.length,
    streamUrlRoundTrip: entries[0]?.url === reviewStreamUrl,
    channelReconciled: channelPage.total === 1,
    channelEditSurvivedRefresh:
      reconciledChannels.channels[0]?.id === yleChannel.id &&
      reconciledChannels.channels[0]?.reconciliationStatus === 'matched',
    reviewSnapshotImported: !reviewSnapshot.unchanged,
    reviewDetected:
      reviewBefore.missingCount === 1 && reviewBefore.newCount === 1,
    manualMatchPreservedIdentity:
      manualResolved?.id === yleChannel.id &&
      manualResolved.customName === 'Yle One' &&
      manualResolved.matchLocked,
    displacedNewChannelArchived: activeResolvedChannels.total === 1,
    bulkHideApplied:
      bulkHidden.updatedCount === 1 &&
      !hiddenEntries.some((entry) => entry.name === 'Yle One'),
    bulkRestoreApplied: bulkRestored.updatedCount === 1,
    manualMatchUnlocked: unlocked?.matchLocked === false,
    reviewResolved:
      reviewAfter.missingCount === 0 && reviewAfter.newCount === 0,
    snapshotHistoryVisible:
      historyBeforeRestore.snapshots.length === 3 &&
      historyBeforeRestore.snapshots.some(
        (snapshot) => snapshot.id === reviewSnapshot.id && snapshot.isCurrent,
      ),
    snapshotRestored:
      restoredSnapshot?.id === first.id &&
      restoredSnapshot.isCurrent &&
      restoredEntries.some((entry) => entry.url === streamUrl) &&
      historyAfterRestore.activity.some(
        (activity) => activity.kind === 'snapshot-activate',
      ),
    retainedSnapshotReactivated:
      reactivatedSnapshot.id === reviewSnapshot.id &&
      !reactivatedSnapshot.unchanged &&
      entries.some((entry) => entry.url === reviewStreamUrl) &&
      historyAfterReactivate.snapshots.some(
        (snapshot) => snapshot.id === reviewSnapshot.id && snapshot.isCurrent,
      ) &&
      historyAfterReactivate.activity.some(
        (activity) => activity.kind === 'snapshot-reactivate',
      ),
    channelNameOverridden: entries[0]?.name === 'Yle One',
    channelGroupOverridden:
      entries[0]?.attributes['group-title'] === 'Finnish favourites',
    channelLogoOverridden:
      entries[0]?.attributes['tvg-logo'] === 'https://images.test/yle-one.png',
    groupCount: groups.length,
    outputLocalized: output.includes('18:00 Tennis 8/4'),
    outputEventsChronological:
      output.indexOf('18:00 Tennis 8/4') <
      output.indexOf('21:00 Late final 8/4'),
    outputPlaceholderHidden: !output.includes('Reload your playlist'),
    outputGroupRenamed: output.includes('group-title="Localized events"'),
    outputTokenResolves: resolvedProfile?.sourceId === source.id,
    publishedEndpointOk:
      publishedResponse === undefined ||
      (publishedResponse.ok && publishedOutput.includes('18:00 Tennis 8/4')),
    firstEpgUnchanged: firstEpg.unchanged,
    secondEpgUnchanged: secondEpg.unchanged,
    refreshedEpgImported: !refreshedEpg.unchanged,
    epgRoundTrip:
      guide.channels.length === 1 &&
      guide.programmes[0]?.title === 'Synthetic news',
    epgMissingDetected:
      epgReviewBefore.missingCount === 1 && epgReviewBefore.matchedCount === 0,
    manualEpgMappingPublished:
      manualEpgSaved &&
      mappedEntries[0]?.attributes['tvg-id'] === 'synthetic.yle1' &&
      publishedOutput.includes('tvg-id="synthetic.yle1"'),
    manualEpgMappingSurvivedRefresh:
      epgReviewAfterRefresh.matchedCount === 1 &&
      epgReviewAfterRefresh.manualCount === 1,
    epgMappingAudited: epgHistory.activity.some(
      (activity) => activity.kind === 'manual-epg-map',
    ),
    manualEpgMappingUnlocked:
      manualEpgUnlocked && epgReviewAfterUnlock.missingCount === 1,
    publishedEpgEndpointOk:
      publishedEpgResponse === undefined ||
      (publishedEpgResponse.ok && publishedEpg.includes('Synthetic news')),
    outputTokenRevoked: revoked && revokedProfile === null,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (
    !report.secondUnchanged ||
    !report.changedSnapshotImported ||
    report.entryCount !== 4 ||
    report.groupCount !== 2 ||
    !report.streamUrlRoundTrip ||
    !report.channelReconciled ||
    !report.channelEditSurvivedRefresh ||
    !report.reviewSnapshotImported ||
    !report.reviewDetected ||
    !report.manualMatchPreservedIdentity ||
    !report.displacedNewChannelArchived ||
    !report.bulkHideApplied ||
    !report.bulkRestoreApplied ||
    !report.manualMatchUnlocked ||
    !report.reviewResolved ||
    !report.snapshotHistoryVisible ||
    !report.snapshotRestored ||
    !report.retainedSnapshotReactivated ||
    !report.channelNameOverridden ||
    !report.channelGroupOverridden ||
    !report.channelLogoOverridden ||
    !report.outputLocalized ||
    !report.outputEventsChronological ||
    !report.outputPlaceholderHidden ||
    !report.outputGroupRenamed ||
    !report.outputTokenResolves ||
    !report.publishedEndpointOk ||
    !report.secondEpgUnchanged ||
    !report.refreshedEpgImported ||
    !report.epgRoundTrip ||
    !report.epgMissingDetected ||
    !report.manualEpgMappingPublished ||
    !report.manualEpgMappingSurvivedRefresh ||
    !report.epgMappingAudited ||
    !report.manualEpgMappingUnlocked ||
    !report.publishedEpgEndpointOk ||
    !report.outputTokenRevoked
  ) {
    throw new Error('Synthetic PostgreSQL integration verification failed');
  }
} finally {
  await repository.close();
}
