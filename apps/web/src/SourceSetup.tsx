import { type FormEvent, useEffect, useState } from 'react';

interface Capabilities {
  sourcePersistence: boolean;
  databaseConfigured: boolean;
  encryptionConfigured: boolean;
  playlistAutomation: boolean;
  epgAutomation: boolean;
}

interface SafeSource {
  id: string;
  name: string;
  sourceType: 'm3u' | 'xtream';
  sourceTimezone: string;
  displayTimezone: string;
  enabled: boolean;
  hasEpgUrl: boolean;
}

interface ImportSummary {
  fingerprint: string;
  totalBytes: number;
  retainedLiveEntries: number;
  skippedEntries: number;
  mediaCounts: Record<string, number>;
  issues: number;
}

interface EpgImportSummary {
  totalBytes: number;
  channelCount: number;
  programmeCount: number;
  issueCount: number;
  issuesTruncated: boolean;
}

interface GroupSummary {
  providerGroup: string;
  channelCount: number;
  configured: boolean;
  behavior: 'permanent' | 'event';
  enabled: boolean;
  outputGroupName?: string;
  hidePlaceholders: boolean;
}

interface CreatedOutputProfile {
  id: string;
  name: string;
  accessToken: string;
  playlistPath: string;
  epgPath: string;
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

export function SourceSetup() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [sources, setSources] = useState<SafeSource[]>([]);
  const [name, setName] = useState('Home provider');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [epgUrl, setEpgUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [importingEpgId, setImportingEpgId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null,
  );
  const [epgImportSummary, setEpgImportSummary] =
    useState<EpgImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupFilter, setGroupFilter] = useState('Events FI');
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [creatingOutput, setCreatingOutput] = useState(false);
  const [outputProfile, setOutputProfile] =
    useState<CreatedOutputProfile | null>(null);
  const [playlistOutputUrl, setPlaylistOutputUrl] = useState('');
  const [epgOutputUrl, setEpgOutputUrl] = useState('');

  async function loadGroups(sourceId: string) {
    const response = await fetch(`/api/v1/sources/${sourceId}/groups`);
    const payload = await readJson<{ groups: GroupSummary[] }>(response);
    setGroups(payload.groups);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const capabilitiesResponse = await fetch('/api/v1/system/capabilities');
        const nextCapabilities =
          await readJson<Capabilities>(capabilitiesResponse);
        if (!active) return;
        setCapabilities(nextCapabilities);
        if (nextCapabilities.sourcePersistence) {
          const sourcesResponse = await fetch('/api/v1/sources');
          const payload = await readJson<{ sources: SafeSource[] }>(
            sourcesResponse,
          );
          if (active) {
            setSources(payload.sources);
            const firstSource = payload.sources[0];
            if (firstSource) await loadGroups(firstSource.id);
          }
        }
      } catch (caught) {
        if (active)
          setError(
            caught instanceof Error ? caught.message : 'Setup check failed',
          );
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  async function saveSource(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          sourceType: 'm3u',
          playlistUrl,
          ...(epgUrl ? { epgUrl } : {}),
          sourceTimezone: 'Europe/Stockholm',
          displayTimezone: 'Europe/Helsinki',
        }),
      });
      const payload = await readJson<{ source: SafeSource }>(response);
      setSources((current) => [...current, payload.source]);
      setPlaylistUrl('');
      setEpgUrl('');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save source',
      );
    } finally {
      setSaving(false);
    }
  }

  async function inspectSource(source: SafeSource) {
    setInspectingId(source.id);
    setImportSummary(null);
    setError(null);
    try {
      const response = await fetch(`/api/v1/sources/${source.id}/import`, {
        method: 'POST',
      });
      const payload = await readJson<{ summary: ImportSummary }>(response);
      setImportSummary(payload.summary);
      await loadGroups(source.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not inspect source',
      );
    } finally {
      setInspectingId(null);
    }
  }

  async function importEpg(source: SafeSource) {
    setImportingEpgId(source.id);
    setEpgImportSummary(null);
    setError(null);
    try {
      const response = await fetch(`/api/v1/sources/${source.id}/epg/import`, {
        method: 'POST',
      });
      const payload = await readJson<{ inspection: EpgImportSummary }>(
        response,
      );
      setEpgImportSummary(payload.inspection);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not import XMLTV',
      );
    } finally {
      setImportingEpgId(null);
    }
  }

  async function setGroupBehavior(
    source: SafeSource,
    group: GroupSummary,
    behavior: 'permanent' | 'event',
  ) {
    setSavingGroup(group.providerGroup);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/sources/${source.id}/group-policies`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            groupName: group.providerGroup,
            behavior,
            enabled: true,
            hidePlaceholders: true,
            sourceTimeZone: 'Europe/Stockholm',
            displayTimeZone: 'Europe/Helsinki',
            numericDateOrder: 'month-day',
          }),
        },
      );
      const payload = await readJson<{ group: GroupSummary }>(response);
      setGroups((current) =>
        current.map((candidate) =>
          candidate.providerGroup === payload.group.providerGroup
            ? payload.group
            : candidate,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not save group policy',
      );
    } finally {
      setSavingGroup(null);
    }
  }

  async function createOutputProfile(source: SafeSource) {
    setCreatingOutput(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/output-profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: source.id, name: 'TiviMate' }),
      });
      const payload = await readJson<{ profile: CreatedOutputProfile }>(
        response,
      );
      setOutputProfile(payload.profile);
      setPlaylistOutputUrl(
        `${window.location.origin}${payload.profile.playlistPath}`,
      );
      setEpgOutputUrl(`${window.location.origin}${payload.profile.epgPath}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not create output URL',
      );
    } finally {
      setCreatingOutput(false);
    }
  }

  async function revokeOutputProfile() {
    if (!outputProfile) return;
    setCreatingOutput(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/output-profiles/${outputProfile.id}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        await readJson<unknown>(response);
      }
      setOutputProfile(null);
      setPlaylistOutputUrl('');
      setEpgOutputUrl('');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not revoke output URL',
      );
    } finally {
      setCreatingOutput(false);
    }
  }

  const normalizedFilter = groupFilter.trim().toLocaleLowerCase();
  const visibleGroups = groups
    .filter((group) =>
      normalizedFilter
        ? group.providerGroup.toLocaleLowerCase().includes(normalizedFilter)
        : group.behavior === 'event',
    )
    .slice(0, 50);
  const primarySource = sources[0];

  return (
    <section className="panel source-panel" id="source-setup">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PRIVATE SOURCE</p>
          <h2>Provider connection</h2>
        </div>
        <span
          className={`pill ${capabilities?.sourcePersistence ? 'ready' : ''}`}
        >
          {capabilities === null
            ? 'Checking…'
            : capabilities.sourcePersistence
              ? 'Encrypted storage ready'
              : 'Preview mode'}
        </span>
      </div>

      {capabilities && !capabilities.sourcePersistence ? (
        <p className="panel-copy">
          Start the Docker Compose stack with a database and master key to
          enable encrypted provider setup. Event-time preview remains available
          below.
        </p>
      ) : null}

      {capabilities?.sourcePersistence && sources.length === 0 ? (
        <form className="source-form" onSubmit={saveSource}>
          <div>
            <label htmlFor="source-name">Source name</label>
            <input
              id="source-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="playlist-url">M3U playlist URL</label>
            <input
              id="playlist-url"
              type="password"
              value={playlistUrl}
              onChange={(event) => setPlaylistUrl(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          <div>
            <label htmlFor="epg-url">XMLTV URL (optional)</label>
            <input
              id="epg-url"
              type="password"
              value={epgUrl}
              onChange={(event) => setEpgUrl(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving securely…' : 'Save encrypted source'}
          </button>
          <p className="secret-note">
            URLs are encrypted before database storage and never shown again.
          </p>
        </form>
      ) : null}

      {sources.length > 0 ? (
        <div className="saved-source-list">
          {sources.map((source) => (
            <article className="saved-source" key={source.id}>
              <div className="source-symbol">TV</div>
              <div>
                <strong>{source.name}</strong>
                <p>
                  {source.sourceType.toUpperCase()} ·{' '}
                  {source.hasEpgUrl ? 'XMLTV configured' : 'No XMLTV URL'}
                </p>
                <small>
                  {source.sourceTimezone} → {source.displayTimezone}
                </small>
                {capabilities?.playlistAutomation ? (
                  <small className="automation-note">
                    Automatic playlist
                    {source.hasEpgUrl && capabilities.epgAutomation
                      ? ' and EPG refresh enabled'
                      : ' refresh enabled'}
                  </small>
                ) : null}
              </div>
              <div className="source-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={inspectingId !== null || importingEpgId !== null}
                  onClick={() => void inspectSource(source)}
                >
                  {inspectingId === source.id
                    ? 'Importing…'
                    : 'Import live playlist'}
                </button>
                {source.hasEpgUrl ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={inspectingId !== null || importingEpgId !== null}
                    onClick={() => void importEpg(source)}
                  >
                    {importingEpgId === source.id
                      ? 'Importing guide…'
                      : 'Import XMLTV guide'}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {importSummary ? (
        <div className="import-summary" aria-live="polite">
          <div>
            <small>LIVE ENTRIES</small>
            <strong>
              {importSummary.retainedLiveEntries.toLocaleString()}
            </strong>
          </div>
          <div>
            <small>VOD/SERIES SKIPPED</small>
            <strong>{importSummary.skippedEntries.toLocaleString()}</strong>
          </div>
          <div>
            <small>DOWNLOAD SIZE</small>
            <strong>
              {(importSummary.totalBytes / 1_000_000).toFixed(1)} MB
            </strong>
          </div>
          <div>
            <small>PARSE ISSUES</small>
            <strong>{importSummary.issues.toLocaleString()}</strong>
          </div>
        </div>
      ) : null}

      {epgImportSummary ? (
        <div className="import-summary" aria-live="polite">
          <div>
            <small>EPG CHANNELS</small>
            <strong>{epgImportSummary.channelCount.toLocaleString()}</strong>
          </div>
          <div>
            <small>PROGRAMMES</small>
            <strong>{epgImportSummary.programmeCount.toLocaleString()}</strong>
          </div>
          <div>
            <small>DOWNLOAD SIZE</small>
            <strong>
              {(epgImportSummary.totalBytes / 1_000_000).toFixed(1)} MB
            </strong>
          </div>
          <div>
            <small>PARSE ISSUES</small>
            <strong>
              {epgImportSummary.issueCount.toLocaleString()}
              {epgImportSummary.issuesTruncated ? '+' : ''}
            </strong>
          </div>
        </div>
      ) : null}

      {groups.length > 0 && primarySource ? (
        <div className="group-policy-editor">
          <div className="subsection-heading">
            <div>
              <small>GROUP RULES</small>
              <strong>Choose transient live-event groups</strong>
            </div>
            <input
              aria-label="Filter provider groups"
              placeholder="Filter groups"
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
            />
          </div>
          <p className="secret-note">
            Event groups receive Swedish-to-Finnish time conversion and
            placeholder filtering. Ordinary TV groups remain unchanged.
          </p>
          <div className="group-list">
            {visibleGroups.map((group) => (
              <div className="group-row" key={group.providerGroup}>
                <div>
                  <strong>{group.providerGroup || '(Ungrouped)'}</strong>
                  <small>
                    {group.channelCount.toLocaleString()} live entries
                  </small>
                </div>
                <span className={`behavior-badge ${group.behavior}`}>
                  {group.behavior === 'event' ? 'LIVE EVENT' : 'LIVE TV'}
                </span>
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={savingGroup !== null}
                  onClick={() =>
                    void setGroupBehavior(
                      primarySource,
                      group,
                      group.behavior === 'event' ? 'permanent' : 'event',
                    )
                  }
                >
                  {savingGroup === group.providerGroup
                    ? 'Saving…'
                    : group.behavior === 'event'
                      ? 'Treat as TV'
                      : 'Mark as event'}
                </button>
              </div>
            ))}
            {visibleGroups.length === 0 ? (
              <p className="empty-groups">No groups match this filter.</p>
            ) : null}
          </div>

          <div className="output-setup">
            <div>
              <strong>TiviMate playlist and EPG URLs</strong>
              <small>
                Create a private, revocable URL after your group rules are
                ready.
              </small>
            </div>
            <button
              type="button"
              disabled={creatingOutput}
              onClick={() => void createOutputProfile(primarySource)}
            >
              {creatingOutput ? 'Creating…' : 'Create TiviMate URL'}
            </button>
          </div>
          {playlistOutputUrl ? (
            <div className="output-url">
              <label htmlFor="playlist-output-url">M3U playlist URL</label>
              <input
                id="playlist-output-url"
                readOnly
                value={playlistOutputUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <label htmlFor="epg-output-url">XMLTV EPG URL</label>
              <input
                id="epg-output-url"
                readOnly
                value={epgOutputUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <small>
                This token is shown only for the current browser session.
              </small>
              <button
                className="revoke-button"
                type="button"
                disabled={creatingOutput}
                onClick={() => void revokeOutputProfile()}
              >
                Revoke this URL
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="message error">{error}</p> : null}
    </section>
  );
}
