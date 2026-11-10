import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { errorMessage, readJson } from '../readJson.js';
import { showToast } from '../toast.js';
import { relativeTime } from './status.js';

interface EpgSourceSummary {
  id: string;
  kind: 'provider' | 'custom';
  name: string;
  ownerSourceId?: string;
  enabled: boolean;
  channelCount: number;
  programmeCount: number;
  importedAt?: string;
  lastError?: string;
}

/** The saved link of a guide the administrator added, editable in place. */
function GuideLink({
  epgSource,
  disabled,
  onSaved,
}: {
  epgSource: EpgSourceSummary;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch(`/api/v1/epg-sources/${epgSource.id}/connection`)
      .then((response) => readJson<{ url: string }>(response))
      .then((payload) => {
        setSaved(payload.url);
        setUrl(payload.url);
      })
      .catch((caught: unknown) =>
        showToast('error', errorMessage(caught, 'Could not load guide link')),
      );
  }, [epgSource.id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/epg-sources/${epgSource.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!response.ok) await readJson<unknown>(response);
      setSaved(url.trim());
      onSaved();
    } catch (caught) {
      showToast('error', errorMessage(caught, 'Could not save guide link'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="ui-row epg-guide-link"
      onSubmit={(event) => void save(event)}
    >
      <div className="ui-field ui-grow">
        <label htmlFor={`guide-link-${epgSource.id}`}>Guide link (XMLTV)</label>
        <input
          id={`guide-link-${epgSource.id}`}
          className="ui-input mono"
          type="text"
          spellCheck={false}
          autoComplete="off"
          required
          disabled={saved === null}
          placeholder={saved === null ? 'Loading…' : undefined}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>
      <button
        className="ui-button"
        type="submit"
        disabled={disabled || saving || saved === null || url.trim() === saved}
      >
        {saving ? 'Saving…' : 'Save link'}
      </button>
    </form>
  );
}

interface EpgSourcesPanelProps {
  active: boolean;
}

/**
 * Manages the shared guide pool: provider guides appear automatically after
 * their first import, custom XMLTV guides can be added with a name and link.
 * Every guide is usable by every provider's channels on the Guide page.
 */
export function EpgSourcesPanel({ active }: EpgSourcesPanelProps) {
  const [epgSources, setEpgSources] = useState<EpgSourceSummary[] | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(
    null,
  );
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/epg-sources');
    const payload = await readJson<{ epgSources: EpgSourceSummary[] }>(
      response,
    );
    setEpgSources(payload.epgSources);
  }, []);

  useEffect(() => {
    if (!active) return;
    void load().catch(() => {
      // The overview stays usable without the guide list.
    });
  }, [active, load]);

  async function importGuide(epgSource: EpgSourceSummary) {
    setImportingId(epgSource.id);
    try {
      const path =
        epgSource.kind === 'provider' && epgSource.ownerSourceId
          ? `/api/v1/sources/${epgSource.ownerSourceId}/epg/import`
          : `/api/v1/epg-sources/${epgSource.id}/import`;
      const response = await fetch(path, { method: 'POST' });
      const payload = await readJson<{
        summary?: { channelCount: number; unchanged: boolean };
      }>(response);
      showToast(
        'success',
        payload.summary
          ? payload.summary.unchanged
            ? `${epgSource.name}: guide is unchanged`
            : `${epgSource.name}: ${payload.summary.channelCount.toLocaleString()} guide channels imported`
          : `${epgSource.name}: import started`,
      );
      await load();
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Guide import failed',
      );
    } finally {
      setImportingId(null);
    }
  }

  async function addGuide(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/v1/epg-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim() }),
      });
      const payload = await readJson<{ epgSource: EpgSourceSummary }>(response);
      setName('');
      setUrl('');
      setAdding(false);
      showToast('success', `${payload.epgSource.name} added`);
      await load();
      await importGuide(payload.epgSource);
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error ? caught.message : 'Could not add EPG source',
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeGuide(epgSource: EpgSourceSummary) {
    setConfirmingRemoval(null);
    setRemovingId(epgSource.id);
    try {
      const response = await fetch(`/api/v1/epg-sources/${epgSource.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) await readJson<unknown>(response);
      showToast('success', `${epgSource.name} removed`);
      await load();
    } catch (caught) {
      showToast(
        'error',
        caught instanceof Error
          ? caught.message
          : 'Could not remove EPG source',
      );
    } finally {
      setRemovingId(null);
    }
  }

  if (!active) return null;

  const locked = importingId !== null || removingId !== null;

  return (
    <section className="ui-section" aria-label="Guides">
      <div className="ui-section-head">
        <h2>Guides</h2>
        <button
          className="ui-button small"
          type="button"
          onClick={() => setAdding((current) => !current)}
        >
          {adding ? 'Cancel' : 'Add guide'}
        </button>
      </div>
      {adding ? (
        <form
          className="ui-card ui-stack"
          onSubmit={(event) => void addGuide(event)}
        >
          <div className="ui-field">
            <label htmlFor="epg-source-name">Name</label>
            <input
              id="epg-source-name"
              className="ui-input"
              value={name}
              placeholder="Open EPG"
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="ui-field">
            <label htmlFor="epg-source-url">Guide link (XMLTV)</label>
            <input
              id="epg-source-url"
              className="ui-input mono"
              type="text"
              value={url}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://…"
              onChange={(event) => setUrl(event.target.value)}
              required
            />
          </div>
          <div>
            <button
              className="ui-button primary"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Adding…' : 'Add guide'}
            </button>
          </div>
        </form>
      ) : null}
      <div className="ui-card">
        {(epgSources ?? []).map((epgSource) => (
          <div className="epg-guide" key={epgSource.id}>
            <div className="ui-row">
              <div className="ui-grow">
                <div className="ui-title">{epgSource.name}</div>
                <div className="ui-soft">
                  {epgSource.kind === 'provider'
                    ? 'From the provider, link set above'
                    : 'Added by you'}{' '}
                  · {epgSource.channelCount.toLocaleString()} channels ·{' '}
                  {epgSource.programmeCount.toLocaleString()} programmes
                </div>
                {epgSource.lastError ? (
                  <div className="ui-danger">
                    Last refresh failed: {epgSource.lastError}
                  </div>
                ) : null}
              </div>
              <div className="ui-status ui-soft">
                <span
                  className={`ui-dot ${
                    epgSource.lastError
                      ? 'warn'
                      : epgSource.importedAt
                        ? 'ok'
                        : 'none'
                  }`}
                />
                {epgSource.importedAt
                  ? `Refreshed ${relativeTime(epgSource.importedAt)}`
                  : 'Not imported yet'}
              </div>
              <div className="ui-actions">
                <button
                  className="ui-button"
                  type="button"
                  disabled={locked}
                  onClick={() => void importGuide(epgSource)}
                >
                  {importingId === epgSource.id ? 'Refreshing…' : 'Refresh'}
                </button>
                {epgSource.kind === 'custom' ? (
                  <button
                    className="ui-button quiet danger"
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      setConfirmingRemoval((current) =>
                        current === epgSource.id ? null : epgSource.id,
                      )
                    }
                  >
                    {removingId === epgSource.id ? 'Removing…' : 'Remove'}
                  </button>
                ) : null}
              </div>
            </div>
            {confirmingRemoval === epgSource.id ? (
              <div className="ui-row ui-warning">
                <div className="ui-grow">
                  Remove {epgSource.name}? Channels matched to this guide lose
                  their guide data and go back to needing attention.
                </div>
                <button
                  className="ui-button danger"
                  type="button"
                  disabled={removingId !== null}
                  onClick={() => void removeGuide(epgSource)}
                >
                  Remove guide
                </button>
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => setConfirmingRemoval(null)}
                >
                  Cancel
                </button>
              </div>
            ) : null}
            {epgSource.kind === 'custom' ? (
              <GuideLink
                epgSource={epgSource}
                disabled={locked}
                onSaved={() => void importGuide(epgSource)}
              />
            ) : null}
          </div>
        ))}
        {epgSources !== null && epgSources.length === 0 ? (
          <div className="ui-row ui-soft">
            No guides yet. Refresh a provider&apos;s guide above, or add one of
            your own.
          </div>
        ) : null}
      </div>
      <p className="ui-note">
        Every guide can be used by the channels of every provider.
      </p>
    </section>
  );
}
