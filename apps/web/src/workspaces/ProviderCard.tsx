import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { errorMessage, readJson } from '../readJson.js';
import { showToast } from '../toast.js';
import { relativeTime, type SourceStatus } from './status.js';

export interface ProviderSource {
  id: string;
  name: string;
  sourceType: 'm3u' | 'xtream';
  sourceTimezone: string;
  displayTimezone: string;
  enabled: boolean;
  hasEpgUrl: boolean;
  importLive: boolean;
  importCatalogue: boolean;
}

interface SavedLinks {
  playlistUrl: string;
  epgUrl?: string;
}

interface ProviderCardProps {
  source: ProviderSource;
  status: SourceStatus | undefined;
  /** Something is being imported or removed, for this provider or another. */
  locked: boolean;
  refreshing: boolean;
  refreshingGuide: boolean;
  removing: boolean;
  onSaved: (source: ProviderSource, importGuide: boolean) => void;
  onRefresh: () => void;
  onRefreshGuide: () => void;
  onRemove: () => void;
}

/**
 * One provider with its saved links shown in full, so a changed username,
 * password or host can be corrected in place.
 */
export function ProviderCard({
  source,
  status,
  locked,
  refreshing,
  refreshingGuide,
  removing,
  onSaved,
  onRefresh,
  onRefreshGuide,
  onRemove,
}: ProviderCardProps) {
  const [links, setLinks] = useState<SavedLinks | null>(null);
  const [playlist, setPlaylist] = useState('');
  const [guide, setGuide] = useState('');
  const [name, setName] = useState(source.name);
  const [sourceType, setSourceType] = useState(source.sourceType);
  const [importLive, setImportLive] = useState(source.importLive);
  const [importCatalogue, setImportCatalogue] = useState(
    source.importCatalogue,
  );
  const [timezone, setTimezone] = useState(source.sourceTimezone);
  const [saving, setSaving] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const loadLinks = useCallback(async () => {
    const response = await fetch(`/api/v1/sources/${source.id}/connection`);
    const saved = await readJson<SavedLinks>(response);
    setLinks(saved);
    setPlaylist(saved.playlistUrl);
    setGuide(saved.epgUrl ?? '');
  }, [source.id]);

  useEffect(() => {
    void loadLinks().catch((caught: unknown) =>
      showToast('error', errorMessage(caught, 'Could not load saved links')),
    );
  }, [loadLinks]);

  const guideChanged = links !== null && guide.trim() !== (links.epgUrl ?? '');
  const dirty =
    guideChanged ||
    (links !== null && playlist.trim() !== links.playlistUrl) ||
    name.trim() !== source.name ||
    sourceType !== source.sourceType ||
    importLive !== source.importLive ||
    importCatalogue !== source.importCatalogue ||
    timezone.trim() !== source.sourceTimezone;

  async function put(changes: Record<string, unknown>, importGuide: boolean) {
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/sources/${source.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || source.name,
          importLive,
          importCatalogue,
          sourceTimezone: timezone.trim() || source.sourceTimezone,
          displayTimezone: source.displayTimezone,
          ...changes,
        }),
      });
      const payload = await readJson<{ source: ProviderSource }>(response);
      await loadLinks();
      showToast(
        'success',
        payload.source.sourceType !== source.sourceType
          ? 'Import method checked and saved. Refresh the playlist to load it the new way.'
          : `${payload.source.name} saved`,
      );
      onSaved(payload.source, importGuide);
    } catch (caught) {
      showToast('error', errorMessage(caught, 'Could not save the provider'));
    } finally {
      setSaving(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void put(
      {
        ...(sourceType !== source.sourceType ? { sourceType } : {}),
        ...(links !== null && playlist.trim() !== links.playlistUrl
          ? { playlistUrl: playlist.trim() }
          : {}),
        ...(guideChanged
          ? guide.trim()
            ? { epgUrl: guide.trim() }
            : { clearEpgUrl: true }
          : {}),
      },
      guideChanged && guide.trim() !== '',
    );
  }

  const lastSync = status?.lastPlaylistSync;
  const busy = saving || locked;

  return (
    <article className="ui-card">
      <div className="ui-row">
        <div className="ui-grow">
          <div className="ui-title">{source.name}</div>
          <div className="ui-soft">
            {source.sourceType === 'xtream' ? 'Xtream login' : 'M3U link'} ·
            times in {source.sourceTimezone} · live TV{' '}
            {source.importLive ? 'on' : 'off'}, movies and series{' '}
            {source.importCatalogue ? 'on' : 'off'}
          </div>
        </div>
        <div className="ui-status ui-soft" title={lastSync?.error}>
          <span
            className={`ui-dot ${
              !lastSync
                ? 'none'
                : lastSync.status === 'succeeded'
                  ? 'ok'
                  : 'warn'
            }`}
          />
          {!lastSync
            ? 'Not imported yet'
            : lastSync.status === 'succeeded'
              ? `Refreshed ${relativeTime(lastSync.finishedAt)}`
              : `Refresh failed ${relativeTime(lastSync.finishedAt)}`}
        </div>
        <div className="ui-actions">
          <button
            className="ui-button"
            type="button"
            disabled={busy}
            onClick={onRefresh}
          >
            {refreshing ? 'Refreshing…' : 'Refresh playlist'}
          </button>
          {source.hasEpgUrl ? (
            <button
              className="ui-button"
              type="button"
              disabled={busy}
              onClick={onRefreshGuide}
            >
              {refreshingGuide ? 'Refreshing…' : 'Refresh guide'}
            </button>
          ) : null}
          <button
            className="ui-button quiet danger"
            type="button"
            disabled={busy}
            onClick={() => setConfirmingRemoval((current) => !current)}
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>

      {confirmingRemoval ? (
        <div className="ui-row ui-warning">
          <div className="ui-grow">
            Remove {source.name}? Its channels, guide data and edits are deleted
            for good, and player links that include it stop working.
          </div>
          <button
            className="ui-button danger"
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmingRemoval(false);
              onRemove();
            }}
          >
            Remove permanently
          </button>
          <button
            className="ui-button"
            type="button"
            onClick={() => setConfirmingRemoval(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <form className="ui-stack" onSubmit={save}>
        <div className="ui-field">
          <label htmlFor={`provider-playlist-${source.id}`}>
            Playlist link
          </label>
          <input
            id={`provider-playlist-${source.id}`}
            className="ui-input mono"
            type="text"
            spellCheck={false}
            autoComplete="off"
            required
            disabled={links === null}
            placeholder={links === null ? 'Loading…' : undefined}
            value={playlist}
            onChange={(event) => setPlaylist(event.target.value)}
          />
        </div>
        <div className="ui-field">
          <label htmlFor={`provider-guide-${source.id}`}>
            Guide link (XMLTV)
          </label>
          <input
            id={`provider-guide-${source.id}`}
            className="ui-input mono"
            type="text"
            spellCheck={false}
            autoComplete="off"
            disabled={links === null}
            placeholder={links === null ? 'Loading…' : 'No guide link'}
            value={guide}
            onChange={(event) => setGuide(event.target.value)}
          />
          {links !== null && !links.epgUrl && guide.trim() === '' ? (
            <button
              className="ui-link"
              type="button"
              disabled={busy}
              onClick={() => void put({ deriveEpgUrl: true }, true)}
            >
              Use the guide link that matches the playlist link
            </button>
          ) : null}
        </div>

        <details className="ui-details">
          <summary>More settings</summary>
          <div className="ui-stack">
            <div className="ui-field">
              <label htmlFor={`provider-name-${source.id}`}>Name</label>
              <input
                id={`provider-name-${source.id}`}
                className="ui-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="ui-field">
              <label htmlFor={`provider-method-${source.id}`}>
                How the playlist is read
              </label>
              <select
                id={`provider-method-${source.id}`}
                className="ui-input"
                value={sourceType}
                onChange={(event) =>
                  setSourceType(event.target.value as 'm3u' | 'xtream')
                }
              >
                <option value="m3u">As an M3U playlist</option>
                <option value="xtream">
                  Through the Xtream API (series as shows)
                </option>
              </select>
              <span className="ui-muted">
                The Xtream API avoids importing every episode as its own row.
                Changing this checks the provider first, which can take a few
                minutes. Nothing is saved if the check fails.
              </span>
            </div>
            <div className="ui-field">
              <span className="ui-label">Import from this provider</span>
              <div className="ui-chips">
                <label className="ui-check">
                  <input
                    type="checkbox"
                    checked={importLive}
                    onChange={(event) => setImportLive(event.target.checked)}
                  />
                  Live TV
                </label>
                <label className="ui-check">
                  <input
                    type="checkbox"
                    checked={importCatalogue}
                    onChange={(event) =>
                      setImportCatalogue(event.target.checked)
                    }
                  />
                  Movies and series
                </label>
              </div>
            </div>
            <div className="ui-field">
              <label htmlFor={`provider-timezone-${source.id}`}>
                Timezone the provider writes event times in
              </label>
              <input
                id={`provider-timezone-${source.id}`}
                className="ui-input"
                list="timezone-choices"
                autoComplete="off"
                spellCheck={false}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </div>
          </div>
        </details>

        <div className="ui-status">
          <button
            className="ui-button primary"
            type="submit"
            disabled={!dirty || busy}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <span className="ui-muted">
            Edit any part of a link in place. A changed link is used from the
            next refresh.
          </span>
        </div>
      </form>
    </article>
  );
}
