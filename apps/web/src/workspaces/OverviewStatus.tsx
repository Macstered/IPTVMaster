export interface SourceSyncStatus {
  status: 'succeeded' | 'failed' | 'rejected';
  finishedAt: string;
  error?: string;
}

export interface SourceStatus {
  sourceId: string;
  name: string;
  enabled: boolean;
  channelCount: number;
  visibleChannelCount: number;
  groupCount: number;
  reviewPending: number;
  epgMappable: number;
  epgMapped: number;
  epgExcluded: number;
  lastPlaylistSync?: SourceSyncStatus;
  lastEpgSync?: SourceSyncStatus;
}

export interface SystemStatus {
  sources: SourceStatus[];
  outputProfileCount: number;
  automation: {
    playlist: { enabled: boolean; intervalMinutes: number };
    epg: { enabled: boolean; intervalMinutes: number };
  };
}

export function relativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function SyncLine({
  label,
  sync,
}: {
  label: string;
  sync: SourceSyncStatus | undefined;
}) {
  if (!sync) {
    return (
      <p className="status-sync">
        <span className="sync-dot none" aria-hidden="true" />
        {label}: never imported
      </p>
    );
  }
  const failed = sync.status !== 'succeeded';
  return (
    <p className="status-sync" title={sync.error}>
      <span
        className={`sync-dot ${failed ? 'failed' : 'ok'}`}
        aria-hidden="true"
      />
      {label}: {sync.status} {relativeTime(sync.finishedAt)}
    </p>
  );
}

interface OverviewStatusProps {
  status: SystemStatus | null;
  onOpenLineup: () => void;
  onOpenEpg: () => void;
}

export function OverviewStatus({
  status,
  onOpenLineup,
  onOpenEpg,
}: OverviewStatusProps) {
  if (!status || status.sources.length === 0) return null;
  const reviewPending = status.sources.reduce(
    (total, source) => total + source.reviewPending,
    0,
  );
  const epgPending = status.sources.reduce(
    (total, source) =>
      total + Math.max(source.epgMappable - source.epgMapped, 0),
    0,
  );
  const automationParts: string[] = [];
  if (status.automation.playlist.enabled) {
    automationParts.push(
      `playlist every ${status.automation.playlist.intervalMinutes} min`,
    );
  }
  if (status.automation.epg.enabled) {
    automationParts.push(
      `EPG every ${status.automation.epg.intervalMinutes} min`,
    );
  }

  return (
    <section className="status-board" aria-label="Provider status">
      {reviewPending + epgPending > 0 ? (
        <div className="attention-banner">
          <strong>Needs attention</strong>
          <div className="attention-actions">
            {reviewPending > 0 ? (
              <button type="button" onClick={onOpenLineup}>
                {reviewPending} provider change
                {reviewPending === 1 ? '' : 's'} to review
              </button>
            ) : null}
            {epgPending > 0 ? (
              <button type="button" onClick={onOpenEpg}>
                {epgPending} channel{epgPending === 1 ? '' : 's'} without EPG
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="status-card-grid">
        {status.sources.map((source) => (
          <article className="provider-status-card" key={source.sourceId}>
            <div className="provider-status-heading">
              <strong>{source.name}</strong>
              <span
                className={`sync-dot ${source.enabled ? 'ok' : 'none'}`}
                aria-hidden="true"
              />
            </div>
            <dl>
              <div>
                <dt>Channels</dt>
                <dd>
                  {source.visibleChannelCount.toLocaleString()}
                  {source.visibleChannelCount !== source.channelCount
                    ? ` of ${source.channelCount.toLocaleString()}`
                    : ''}{' '}
                  shown
                </dd>
              </div>
              <div>
                <dt>Groups</dt>
                <dd>{source.groupCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>EPG</dt>
                <dd>
                  {source.epgMappable > 0
                    ? `${source.epgMapped.toLocaleString()} of ${source.epgMappable.toLocaleString()} mapped`
                    : '—'}
                  {source.epgExcluded > 0
                    ? ` · ${source.epgExcluded.toLocaleString()} excluded`
                    : ''}
                </dd>
              </div>
            </dl>
            <SyncLine label="Playlist" sync={source.lastPlaylistSync} />
            <SyncLine label="Guide" sync={source.lastEpgSync} />
          </article>
        ))}
      </div>
      {automationParts.length > 0 ? (
        <p className="automation-line">
          Automatic refresh: {automationParts.join(' · ')} ·{' '}
          {status.outputProfileCount.toLocaleString()} active output URL
          {status.outputProfileCount === 1 ? '' : 's'}
        </p>
      ) : null}
    </section>
  );
}
