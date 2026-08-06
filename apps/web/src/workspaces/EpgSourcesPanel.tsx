import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { showToast } from '../toast.js';
import { relativeTime } from './OverviewStatus.js';

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

interface EpgSourcesPanelProps {
  active: boolean;
}

/**
 * Manages the shared guide pool: provider guides appear automatically after
 * their first import, custom XMLTV guides can be added with a name and URL.
 * Every guide is usable by every provider's channels in the EPG workspace.
 */
export function EpgSourcesPanel({ active }: EpgSourcesPanelProps) {
  const [epgSources, setEpgSources] = useState<EpgSourceSummary[] | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
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

  return (
    <section className="epg-sources-panel" aria-label="EPG sources">
      <div className="subsection-heading">
        <div>
          <small>EPG SOURCES</small>
          <strong>Guides shared by every provider</strong>
        </div>
        {epgSources ? (
          <span className="channel-count">
            {epgSources.length.toLocaleString()}{' '}
            {epgSources.length === 1 ? 'guide' : 'guides'}
          </span>
        ) : null}
      </div>
      <p className="secret-note">
        Provider guides appear here after their first import. Add any extra
        XMLTV URL as a custom guide — its channels become available to every
        provider in the EPG workspace. Custom URLs are encrypted and never shown
        again.
      </p>
      <div className="epg-source-list">
        {(epgSources ?? []).map((epgSource) => (
          <article className="epg-source-row" key={epgSource.id}>
            <div className="epg-source-main">
              <strong>{epgSource.name}</strong>
              <small>
                {epgSource.channelCount.toLocaleString()} channels ·{' '}
                {epgSource.programmeCount.toLocaleString()} programmes
                {epgSource.importedAt
                  ? ` · imported ${relativeTime(epgSource.importedAt)}`
                  : ' · never imported'}
              </small>
              {epgSource.lastError ? (
                <small className="epg-source-error">
                  Last refresh failed: {epgSource.lastError}
                </small>
              ) : null}
            </div>
            <span className={`behavior-badge ${epgSource.kind}`}>
              {epgSource.kind === 'provider' ? 'Provider' : 'Custom'}
            </span>
            <button
              className="secondary-button compact"
              type="button"
              disabled={importingId !== null || removingId !== null}
              onClick={() => void importGuide(epgSource)}
            >
              {importingId === epgSource.id ? 'Importing…' : 'Import now'}
            </button>
            {epgSource.kind === 'custom' ? (
              <button
                className="danger-button compact"
                type="button"
                disabled={importingId !== null || removingId !== null}
                onClick={() =>
                  setConfirmingRemoval((current) =>
                    current === epgSource.id ? null : epgSource.id,
                  )
                }
              >
                {removingId === epgSource.id ? 'Removing…' : 'Remove'}
              </button>
            ) : null}
            {confirmingRemoval === epgSource.id ? (
              <div className="snapshot-confirm epg-source-confirm">
                <p>
                  Remove {epgSource.name}? Channels mapped to this guide lose
                  their guide data and return to the review queue.
                </p>
                <div>
                  <button
                    className="danger-button compact"
                    type="button"
                    disabled={removingId !== null}
                    onClick={() => void removeGuide(epgSource)}
                  >
                    Remove guide
                  </button>
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={removingId !== null}
                    onClick={() => setConfirmingRemoval(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
        {epgSources !== null && epgSources.length === 0 ? (
          <p className="empty-groups">
            No guides yet. Import a provider guide from its card above, or add a
            custom XMLTV URL below.
          </p>
        ) : null}
      </div>
      <form
        className="epg-source-form"
        onSubmit={(event) => void addGuide(event)}
      >
        <div>
          <label htmlFor="epg-source-name">Guide name</label>
          <input
            id="epg-source-name"
            value={name}
            placeholder="Open EPG"
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="epg-source-url">XMLTV URL</label>
          <input
            id="epg-source-url"
            type="password"
            value={url}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…"
            onChange={(event) => setUrl(event.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={saving}>
          {saving ? 'Adding…' : 'Add custom guide'}
        </button>
      </form>
    </section>
  );
}
