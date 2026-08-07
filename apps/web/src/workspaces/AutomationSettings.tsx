import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { showToast } from '../toast.js';

interface SchedulerState {
  available: boolean;
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  nextRunAt?: string;
}

interface AutomationSettingsResponse {
  playlist: SchedulerState;
  epg: SchedulerState;
  limits?: {
    playlistMinimumMinutes: number;
    epgMinimumMinutes: number;
    maximumMinutes: number;
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const value: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      typeof value.error === 'string'
        ? value.error
        : 'Request failed';
    throw new Error(message);
  }
  return value as T;
}

function describeNextRun(state: SchedulerState): string {
  if (state.running) return 'updating now';
  if (!state.enabled) return 'paused';
  if (!state.nextRunAt) return 'running now';
  const dueInMs = new Date(state.nextRunAt).getTime() - Date.now();
  if (dueInMs <= 0) return 'due now';
  const minutes = Math.round(dueInMs / 60_000);
  if (minutes < 60) return `next in ${minutes} min`;
  return `next in ${Math.round(minutes / 60)} h`;
}

interface AutomationSettingsProps {
  active: boolean;
}

/**
 * Refresh scheduling, editable without a restart. The environment values are
 * the defaults; anything changed here is stored and wins after a restart.
 */
export function AutomationSettings({ active }: AutomationSettingsProps) {
  const [settings, setSettings] = useState<AutomationSettingsResponse | null>(
    null,
  );
  const [playlistMinutes, setPlaylistMinutes] = useState('');
  const [epgMinutes, setEpgMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState<'playlist' | 'epg' | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/automation/settings');
    const payload = await readJson<AutomationSettingsResponse>(response);
    setSettings(payload);
    setPlaylistMinutes(String(payload.playlist.intervalMinutes));
    setEpgMinutes(String(payload.epg.intervalMinutes));
  }, []);

  useEffect(() => {
    if (!active) return;
    void load().catch(() => {
      // The overview stays usable without the schedule card.
    });
  }, [active, load]);

  // A cycle finishes on the server, so while one runs the card polls to notice
  // it ending. The interval is cleared as soon as nothing is running.
  const refreshing =
    settings?.playlist.running === true || settings?.epg.running === true;
  useEffect(() => {
    if (!active || !refreshing) return;
    const timer = setInterval(() => {
      void load().catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [active, refreshing, load]);

  async function save(update: Record<string, number | boolean>) {
    setSaving(true);
    try {
      const response = await fetch('/api/v1/automation/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(update),
      });
      const payload = await readJson<AutomationSettingsResponse>(response);
      setSettings((current) =>
        current ? { ...current, ...payload } : payload,
      );
      setPlaylistMinutes(String(payload.playlist.intervalMinutes));
      setEpgMinutes(String(payload.epg.intervalMinutes));
      showToast('success', 'Refresh schedule updated');
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not update the refresh schedule',
      );
      await load().catch(() => undefined);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Starts a scheduled cycle right now. It covers every enabled provider, and
   * for the guide the custom XMLTV sources too, which is what makes this
   * different from importing on a single provider card.
   */
  async function refreshNow(target: 'playlist' | 'epg') {
    setStarting(target);
    try {
      const response = await fetch('/api/v1/automation/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const payload = await readJson<
        AutomationSettingsResponse & { started: boolean }
      >(response);
      setSettings(payload);
      showToast(
        'success',
        payload.started
          ? `${target === 'playlist' ? 'Playlist' : 'Guide'} update started`
          : `${target === 'playlist' ? 'Playlist' : 'Guide'} update already running`,
      );
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not start the update',
      );
    } finally {
      setStarting(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const playlist = Number(playlistMinutes);
    const epg = Number(epgMinutes);
    const update: Record<string, number> = {};
    if (
      Number.isInteger(playlist) &&
      playlist !== settings?.playlist.intervalMinutes
    ) {
      update['playlistIntervalMinutes'] = playlist;
    }
    if (Number.isInteger(epg) && epg !== settings?.epg.intervalMinutes) {
      update['epgIntervalMinutes'] = epg;
    }
    if (Object.keys(update).length === 0) return;
    void save(update);
  }

  if (!active || !settings) return null;

  const limits = settings.limits;

  return (
    <section className="automation-settings" aria-label="Refresh schedule">
      <div className="subsection-heading">
        <div>
          <small>REFRESH SCHEDULE</small>
          <strong>How often providers are checked</strong>
        </div>
      </div>
      <p className="secret-note">
        Provider feeds change slowly and frequent polling is unwelcome, so
        prefer the longest interval you are comfortable with. A change applies
        immediately and is remembered across restarts. “Update now” runs a full
        cycle over every provider straight away, whether or not automatic
        refresh is paused.
      </p>
      <div className="automation-now">
        <button
          type="button"
          className="secondary-button compact"
          disabled={
            !settings.playlist.available ||
            settings.playlist.running ||
            starting !== null
          }
          onClick={() => void refreshNow('playlist')}
        >
          {settings.playlist.running
            ? 'Updating playlist…'
            : 'Update playlist now'}
        </button>
        <button
          type="button"
          className="secondary-button compact"
          disabled={
            !settings.epg.available || settings.epg.running || starting !== null
          }
          onClick={() => void refreshNow('epg')}
        >
          {settings.epg.running ? 'Updating guide…' : 'Update guide now'}
        </button>
      </div>
      <form className="automation-form" onSubmit={submit}>
        <div>
          <label htmlFor="playlist-interval">Playlist every (minutes)</label>
          <input
            id="playlist-interval"
            type="number"
            inputMode="numeric"
            min={limits?.playlistMinimumMinutes ?? 15}
            max={limits?.maximumMinutes ?? 10080}
            step={5}
            value={playlistMinutes}
            disabled={!settings.playlist.available || saving}
            onChange={(event) => setPlaylistMinutes(event.target.value)}
          />
          <small>{describeNextRun(settings.playlist)}</small>
        </div>
        <div>
          <label htmlFor="epg-interval">Guide every (minutes)</label>
          <input
            id="epg-interval"
            type="number"
            inputMode="numeric"
            min={limits?.epgMinimumMinutes ?? 30}
            max={limits?.maximumMinutes ?? 10080}
            step={30}
            value={epgMinutes}
            disabled={!settings.epg.available || saving}
            onChange={(event) => setEpgMinutes(event.target.value)}
          />
          <small>{describeNextRun(settings.epg)}</small>
        </div>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
      </form>
      <div className="automation-toggles">
        <label className="permanent-visibility-toggle">
          <input
            type="checkbox"
            checked={settings.playlist.enabled}
            disabled={!settings.playlist.available || saving}
            onChange={(event) =>
              void save({ playlistEnabled: event.target.checked })
            }
          />
          Automatic playlist refresh
        </label>
        <label className="permanent-visibility-toggle">
          <input
            type="checkbox"
            checked={settings.epg.enabled}
            disabled={!settings.epg.available || saving}
            onChange={(event) =>
              void save({ epgEnabled: event.target.checked })
            }
          />
          Automatic guide refresh
        </label>
      </div>
    </section>
  );
}
