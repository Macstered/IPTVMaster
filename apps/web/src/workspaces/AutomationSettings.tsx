import { useCallback, useEffect, useState } from 'react';

import { readJson } from '../readJson.js';
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

  /** Saves an interval once the field is left, if it holds a new number. */
  function commit(target: 'playlist' | 'epg') {
    const current = settings?.[target].intervalMinutes;
    const typed = Number(target === 'playlist' ? playlistMinutes : epgMinutes);
    if (Number.isInteger(typed) && typed > 0 && typed !== current) {
      void save({
        [target === 'playlist'
          ? 'playlistIntervalMinutes'
          : 'epgIntervalMinutes']: typed,
      });
      return;
    }
    if (target === 'playlist') setPlaylistMinutes(String(current ?? ''));
    else setEpgMinutes(String(current ?? ''));
  }

  if (!active || !settings) return null;

  const limits = settings.limits;
  const rows = [
    {
      target: 'playlist' as const,
      label: 'Playlists',
      state: settings.playlist,
      value: playlistMinutes,
      setValue: setPlaylistMinutes,
      minimum: limits?.playlistMinimumMinutes ?? 15,
      step: 5,
      enabledKey: 'playlistEnabled',
    },
    {
      target: 'epg' as const,
      label: 'Guides',
      state: settings.epg,
      value: epgMinutes,
      setValue: setEpgMinutes,
      minimum: limits?.epgMinimumMinutes ?? 30,
      step: 30,
      enabledKey: 'epgEnabled',
    },
  ];

  return (
    <section className="ui-section" aria-label="Automatic refresh">
      <h2>Automatic refresh</h2>
      <div className="ui-card">
        {rows.map((row) => (
          <div className="ui-row" key={row.target}>
            <label
              className="ui-title automation-label"
              htmlFor={`${row.target}-interval`}
            >
              {row.label}
            </label>
            <div className="ui-status ui-soft">
              <span>every</span>
              <input
                id={`${row.target}-interval`}
                className="ui-input automation-interval"
                type="number"
                inputMode="numeric"
                min={row.minimum}
                max={limits?.maximumMinutes ?? 10080}
                step={row.step}
                value={row.value}
                disabled={!row.state.available || saving}
                onChange={(event) => row.setValue(event.target.value)}
                onBlur={() => commit(row.target)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <span>minutes</span>
            </div>
            <span className="ui-muted automation-next">
              {describeNextRun(row.state)}
            </span>
            <button
              className="ui-button"
              type="button"
              disabled={
                !row.state.available || row.state.running || starting !== null
              }
              onClick={() => void refreshNow(row.target)}
            >
              {row.state.running ? 'Refreshing…' : 'Refresh all now'}
            </button>
            <button
              className="ui-switch"
              type="button"
              role="switch"
              aria-checked={row.state.enabled}
              aria-label={`Automatic refresh of ${row.label.toLowerCase()}`}
              disabled={!row.state.available || saving}
              onClick={() =>
                void save({ [row.enabledKey]: !row.state.enabled })
              }
            >
              <span className="ui-switch-track">
                <span />
              </span>
              {row.state.enabled ? 'On' : 'Off'}
            </button>
          </div>
        ))}
      </div>
      <p className="ui-note">
        Changes save as you make them. Providers dislike frequent polling, so
        longer is kinder. “Refresh all now” covers every provider, whether or
        not automatic refresh is on.
      </p>
    </section>
  );
}
