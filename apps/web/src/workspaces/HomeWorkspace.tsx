import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { CopyField } from '../components/CopyField.js';
import { errorMessage, readJson } from '../readJson.js';
import { showToast } from '../toast.js';
import { RefreshActivity } from './RefreshActivity.js';
import {
  relativeTime,
  type SourceStatus,
  type SourceSyncStatus,
  type SystemStatus,
} from './status.js';

interface SchedulerState {
  available: boolean;
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  nextRunAt?: string;
}

interface Schedule {
  playlist: SchedulerState;
  epg: SchedulerState;
}

interface OutputProfile {
  id: string;
  name: string;
  mediaTypes?: Array<'live' | 'vod' | 'series'>;
  recoverable: boolean;
  accessToken?: string;
}

export interface HomeActivity {
  id: string;
  occurredAt: string;
  title: string;
  detail: string;
  status?: 'succeeded' | 'failed' | 'rejected';
}

export type HomeDestination =
  'review' | 'guide' | 'links' | 'providers' | 'history';

interface HomeWorkspaceProps {
  active: boolean;
  status: SystemStatus | null;
  sources: readonly { id: string; name: string; sourceType: string }[];
  activity: readonly HomeActivity[];
  actionSlot: HTMLElement | null;
  onNavigate: (destination: HomeDestination) => void;
  onRefreshStatus: () => void;
}

interface Attention {
  key: string;
  title: string;
  detail: string;
  action: string;
  destination: HomeDestination;
}

const MEDIA_LABELS = { live: 'Live TV', vod: 'Movies', series: 'Series' };

function failed(sync: SourceSyncStatus | undefined): boolean {
  return sync !== undefined && sync.status !== 'succeeded';
}

/** The least fresh of several syncs, which is the honest one to report. */
function oldest(
  syncs: Array<SourceSyncStatus | undefined>,
): SourceSyncStatus | undefined {
  return syncs
    .filter((sync): sync is SourceSyncStatus => sync !== undefined)
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))[0];
}

function nextCheck(schedule: Schedule | null): string {
  if (!schedule) return '';
  const due = [schedule.playlist, schedule.epg]
    .filter((state) => state.enabled && state.nextRunAt)
    .map((state) => new Date(state.nextRunAt ?? '').getTime())
    .sort((a, b) => a - b)[0];
  if (due === undefined) return ' Automatic refresh is paused.';
  const minutes = Math.max(Math.round((due - Date.now()) / 60_000), 0);
  return minutes < 60
    ? ` Next check in ${minutes} min.`
    : ` Next check in ${Math.round(minutes / 60)} h.`;
}

function summary(
  status: SystemStatus,
  schedule: Schedule | null,
): { tone: 'ok' | 'warn' | 'none'; text: string } {
  if (schedule?.playlist.running || schedule?.epg.running) {
    return { tone: 'ok', text: 'Refreshing now…' };
  }
  const broken = status.sources.find(
    (source) => failed(source.lastPlaylistSync) || failed(source.lastEpgSync),
  );
  if (broken) {
    return {
      tone: 'warn',
      text: `The last refresh of ${broken.name} did not go through.${nextCheck(schedule)}`,
    };
  }
  const playlist = oldest(
    status.sources.map((source) => source.lastPlaylistSync),
  );
  if (!playlist)
    return { tone: 'none', text: 'Nothing has been imported yet.' };
  const guide = oldest(status.sources.map((source) => source.lastEpgSync));
  return {
    tone: 'ok',
    text: `Playlist refreshed ${relativeTime(playlist.finishedAt)}${
      guide ? `, guide ${relativeTime(guide.finishedAt)}` : ''
    }.${nextCheck(schedule)}`,
  };
}

function attentionFor(status: SystemStatus): Attention[] {
  const items: Attention[] = [];
  for (const source of status.sources) {
    const sync = failed(source.lastPlaylistSync)
      ? { kind: 'Playlist', run: source.lastPlaylistSync }
      : failed(source.lastEpgSync)
        ? { kind: 'Guide', run: source.lastEpgSync }
        : null;
    if (!sync) continue;
    items.push({
      key: `sync:${source.sourceId}`,
      title: `${sync.kind} refresh failed for ${source.name}`,
      detail:
        sync.run?.error ?? 'The data from the last good refresh is still used.',
      action: 'Open Providers',
      destination: 'providers',
    });
  }
  const withoutGuide = status.sources.reduce(
    (total, source) =>
      total + Math.max(source.epgMappable - source.epgMapped, 0),
    0,
  );
  if (withoutGuide > 0) {
    items.push({
      key: 'guide',
      title: `${withoutGuide.toLocaleString()} ${
        withoutGuide === 1 ? 'channel has' : 'channels have'
      } no guide data`,
      detail:
        'Match them to a guide channel, or mark the ones that never have a guide.',
      action: 'Open Guide',
      destination: 'guide',
    });
  }
  const review = status.sources.reduce(
    (total, source) => total + source.reviewPending,
    0,
  );
  if (review > 0) {
    items.push({
      key: 'review',
      title: `${review.toLocaleString()} provider ${
        review === 1 ? 'change' : 'changes'
      } to review`,
      detail: 'Channels the provider renamed, moved or stopped sending.',
      action: 'Review changes',
      destination: 'review',
    });
  }
  const channels = status.sources.reduce(
    (total, source) => total + source.channelCount,
    0,
  );
  if (channels > 0 && status.outputProfileCount === 0) {
    items.push({
      key: 'links',
      title: 'No player link yet',
      detail: 'Create a private link to load this playlist in your player.',
      action: 'Create link',
      destination: 'links',
    });
  }
  return items;
}

function activityTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    undefined,
    today
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : { day: 'numeric', month: 'short' },
  ).format(date);
}

function SyncCell({
  sync,
  every,
}: {
  sync: SourceSyncStatus | undefined;
  every: SchedulerState | undefined;
}) {
  return (
    <td>
      <div className="ui-status" title={sync?.error}>
        <span
          className={`ui-dot ${!sync ? 'none' : failed(sync) ? 'warn' : 'ok'}`}
        />
        <span className="ui-strong">
          {!sync
            ? 'Never'
            : failed(sync)
              ? `Failed ${relativeTime(sync.finishedAt)}`
              : relativeTime(sync.finishedAt)}
        </span>
      </div>
      <div className="ui-muted">
        {every?.enabled ? `every ${every.intervalMinutes} min` : 'manual only'}
      </div>
    </td>
  );
}

function ProviderRow({
  source,
  kind,
  schedule,
}: {
  source: SourceStatus;
  kind: string | undefined;
  schedule: Schedule | null;
}) {
  const coverage =
    source.epgMappable > 0 ? source.epgMapped / source.epgMappable : 0;
  return (
    <tr>
      <td>
        <div className="ui-title">{source.name}</div>
        <div className="ui-muted">
          {kind === 'xtream' ? 'Xtream login' : 'M3U link'}
          {source.enabled ? '' : ' · paused'}
        </div>
      </td>
      <td>
        <div className="ui-strong">
          {source.visibleChannelCount.toLocaleString()} shown
        </div>
        <div className="ui-muted">
          of {source.channelCount.toLocaleString()} in{' '}
          {source.groupCount.toLocaleString()} groups
        </div>
      </td>
      <td>
        {source.epgMappable > 0 ? (
          <div className="home-coverage">
            <div className="ui-strong">
              {source.epgMapped.toLocaleString()} of{' '}
              {source.epgMappable.toLocaleString()}
            </div>
            <div className="ui-meter">
              <div style={{ width: `${Math.round(coverage * 100)}%` }} />
            </div>
          </div>
        ) : (
          <div className="ui-muted">No guide yet</div>
        )}
      </td>
      <SyncCell sync={source.lastPlaylistSync} every={schedule?.playlist} />
      <SyncCell sync={source.lastEpgSync} every={schedule?.epg} />
    </tr>
  );
}

export function HomeWorkspace({
  active,
  status,
  sources,
  activity,
  actionSlot,
  onNavigate,
  onRefreshStatus,
}: HomeWorkspaceProps) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [profiles, setProfiles] = useState<OutputProfile[] | null>(null);
  const [starting, setStarting] = useState(false);

  const loadSchedule = useCallback(async () => {
    const response = await fetch('/api/v1/automation/settings');
    setSchedule(await readJson<Schedule>(response));
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadSchedule().catch(() => undefined);
    void fetch('/api/v1/output-profiles')
      .then((response) => readJson<{ profiles: OutputProfile[] }>(response))
      .then((payload) => setProfiles(payload.profiles))
      .catch(() => undefined);
  }, [active, loadSchedule]);

  // A refresh finishes on the server. Watch it while it runs, and bring the
  // numbers on this page up to date the moment it ends.
  const refreshing =
    schedule?.playlist.running === true || schedule?.epg.running === true;
  useEffect(() => {
    if (!active || !refreshing) return;
    const timer = window.setInterval(() => {
      void loadSchedule().catch(() => undefined);
    }, 4000);
    return () => {
      window.clearInterval(timer);
      onRefreshStatus();
    };
  }, [active, refreshing, loadSchedule, onRefreshStatus]);

  async function refreshNow() {
    setStarting(true);
    try {
      let latest: Schedule | null = null;
      for (const target of ['playlist', 'epg']) {
        const response = await fetch('/api/v1/automation/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target }),
        });
        latest = await readJson<Schedule>(response);
      }
      if (latest) setSchedule(latest);
      showToast('success', 'Refresh started');
    } catch (caught) {
      showToast('error', errorMessage(caught, 'Could not start the refresh'));
    } finally {
      setStarting(false);
    }
  }

  if (!active) return null;
  if (!status) return <p className="ui-note">Loading…</p>;

  // The provider list is live; the status summary can lag a few seconds.
  if (sources.length === 0) {
    return (
      <div className="ui-page">
        <div className="ui-card ui-row">
          <div className="ui-grow">
            <div className="ui-title">Add your first provider</div>
            <div className="ui-soft">
              Paste the playlist link from your IPTV provider. Channels, guide
              data and player links follow from there.
            </div>
          </div>
          <button
            className="ui-button primary"
            type="button"
            onClick={() => onNavigate('providers')}
          >
            Add provider
          </button>
        </div>
      </div>
    );
  }

  const state = summary(status, schedule);
  const attention = attentionFor(status);
  const profile = profiles?.find(
    (candidate) => candidate.recoverable && candidate.accessToken,
  );
  const mediaTypes = profile?.mediaTypes ?? ['live'];
  const base = profile?.accessToken
    ? `${window.location.origin}/m/${profile.accessToken}`
    : '';

  return (
    <div className="ui-page">
      {actionSlot
        ? createPortal(
            <button
              className="ui-button"
              type="button"
              disabled={
                starting ||
                refreshing ||
                schedule === null ||
                !schedule.playlist.available
              }
              onClick={() => void refreshNow()}
            >
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </button>,
            actionSlot,
          )
        : null}

      <div className="ui-status home-summary" role="status">
        <span className={`ui-dot ${state.tone}`} />
        <span>{state.text}</span>
      </div>

      {refreshing ? <RefreshActivity sources={sources} /> : null}

      <section className="ui-section">
        <h2>Needs your attention</h2>
        <div className="ui-card">
          {attention.length === 0 ? (
            <div className="ui-row">
              <span className="ui-dot ok" />
              <div className="ui-soft">Nothing needs your attention.</div>
            </div>
          ) : (
            attention.map((item, index) => (
              <div className="ui-row" key={item.key}>
                <span className="ui-dot warn" />
                <div className="ui-grow">
                  <div className="ui-title">{item.title}</div>
                  <div className="ui-soft">{item.detail}</div>
                </div>
                <button
                  className={`ui-button ${index === 0 ? 'primary' : ''}`}
                  type="button"
                  onClick={() => onNavigate(item.destination)}
                >
                  {item.action}
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="ui-section">
        <h2>Providers</h2>
        <div className="ui-card ui-scroll-x">
          <table className="ui-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Channels</th>
                <th scope="col">Guide coverage</th>
                <th scope="col">Playlist</th>
                <th scope="col">Guide</th>
              </tr>
            </thead>
            <tbody>
              {status.sources.map((source) => (
                <ProviderRow
                  key={source.sourceId}
                  source={source}
                  kind={
                    sources.find(
                      (candidate) => candidate.id === source.sourceId,
                    )?.sourceType
                  }
                  schedule={schedule}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="home-columns">
        <section className="ui-section">
          <div className="ui-section-head">
            <h2>Player links</h2>
            <button
              className="ui-link"
              type="button"
              onClick={() => onNavigate('links')}
            >
              Manage
            </button>
          </div>
          <div className="ui-card ui-stack">
            {profile ? (
              <>
                <div className="ui-status">
                  <div className="ui-title">{profile.name}</div>
                  {mediaTypes.map((kind) => (
                    <span className="ui-pill" key={kind}>
                      {MEDIA_LABELS[kind]}
                    </span>
                  ))}
                </div>
                <CopyField
                  id="home-playlist-link"
                  label="Playlist (M3U)"
                  value={base}
                />
                {mediaTypes.includes('live') ? (
                  <CopyField
                    id="home-guide-link"
                    label="Guide (XMLTV)"
                    value={`${window.location.origin}/e/${profile.accessToken ?? ''}`}
                  />
                ) : null}
                <div className="ui-muted">
                  Links work like passwords. Xtream login details are under
                  Manage.
                </div>
              </>
            ) : (
              <div className="ui-soft">
                {profiles === null
                  ? 'Loading…'
                  : 'No player link yet. Create one to load this playlist in your player.'}
              </div>
            )}
          </div>
        </section>

        <section className="ui-section">
          <div className="ui-section-head">
            <h2>Recent activity</h2>
            <button
              className="ui-link"
              type="button"
              onClick={() => onNavigate('history')}
            >
              Full history
            </button>
          </div>
          <div className="ui-card">
            {activity.length === 0 ? (
              <div className="ui-row ui-soft">Nothing has happened yet.</div>
            ) : (
              activity.slice(0, 5).map((entry) => (
                <div className="ui-row nowrap" key={entry.id}>
                  <span
                    className={`ui-dot ${
                      entry.status && entry.status !== 'succeeded'
                        ? 'warn'
                        : 'ok'
                    }`}
                  />
                  <div className="ui-grow ui-clip">
                    <span className="ui-strong">{entry.title}</span>
                    <span className="ui-muted"> · {entry.detail}</span>
                  </div>
                  <span className="ui-muted">
                    {activityTime(entry.occurredAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
