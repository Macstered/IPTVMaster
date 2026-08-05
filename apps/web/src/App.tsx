import { type FormEvent, useState } from 'react';

import { SourceSetup, type WorkspaceView } from './SourceSetup.js';

interface PreviewResult {
  originalName: string;
  localizedName: string;
  changed: boolean;
  status: 'localized' | 'no-time' | 'invalid-time' | 'invalid-timezone';
  sourceDateTime?: string;
  displayDateTime?: string;
  crossedDateBoundary: boolean;
  warning?: string;
}

const initialEvent = '17:00 Montreal ATP Tennis 8/4';

const workspaceDetails: Record<
  WorkspaceView,
  { label: string; title: string; subtitle: string; icon: string }
> = {
  overview: {
    label: 'Overview',
    title: 'Playlist overview',
    subtitle: 'Manage providers, refresh sources, and copy your TiviMate URLs.',
    icon: '⌂',
  },
  lineup: {
    label: 'Lineup',
    title: 'Lineup editor',
    subtitle: 'Arrange groups and edit the channels that appear in TiviMate.',
    icon: '▤',
  },
  events: {
    label: 'Live events',
    title: 'Live event rules',
    subtitle: 'Control daily event groups and preview Finnish event times.',
    icon: '◷',
  },
  epg: {
    label: 'EPG mappings',
    title: 'EPG mapping',
    subtitle:
      'Review guide coverage and resolve channels that need a manual match.',
    icon: '▦',
  },
  updates: {
    label: 'Updates',
    title: 'Update history',
    subtitle:
      'Review automatic refreshes and restore a retained playlist snapshot.',
    icon: '↻',
  },
};

const workspaceOrder: WorkspaceView[] = [
  'overview',
  'lineup',
  'events',
  'epg',
  'updates',
];

function displayInstant(value: string | undefined, timeZone: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-FI', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(new Date(value));
}

interface AppProps {
  authUsername?: string;
  onLogout?: () => void;
}

export function App({ authUsername, onLogout }: AppProps) {
  const [workspace, setWorkspace] = useState<WorkspaceView>('overview');
  const [name, setName] = useState(initialEvent);
  const [referenceDate, setReferenceDate] = useState('2026-08-04');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activeWorkspace = workspaceDetails[workspace];

  function openWorkspace(nextWorkspace: WorkspaceView) {
    setWorkspace(nextWorkspace);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function preview(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/event-time/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          policy: {
            sourceTimeZone: 'Europe/Stockholm',
            displayTimeZone: 'Europe/Helsinki',
            numericDateOrder: 'month-day',
            referenceDate,
          },
        }),
      });
      const payload = (await response.json()) as
        PreviewResult | { error: string };
      if (!response.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : 'Preview failed');
      }
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <button
          className="brand"
          type="button"
          aria-label="Open IPTVMaster overview"
          onClick={() => openWorkspace('overview')}
        >
          <span className="brand-mark">IM</span>
          <span>
            <strong>IPTVMaster</strong>
            <small>Local playlist control</small>
          </span>
        </button>

        <nav aria-label="Main navigation">
          {workspaceOrder.map((item) => {
            const details = workspaceDetails[item];
            return (
              <button
                className={`nav-link ${workspace === item ? 'active' : ''}`}
                type="button"
                aria-current={workspace === item ? 'page' : undefined}
                onClick={() => openWorkspace(item)}
                key={item}
              >
                <span aria-hidden="true">{details.icon}</span>
                {details.label}
              </button>
            );
          })}
        </nav>

        <div className="status-card">
          <span className="status-dot" />
          <div>
            <strong>{authUsername ?? 'Foundation running'}</strong>
            <small>{authUsername ? 'Local administrator' : 'Local mode'}</small>
          </div>
          {onLogout ? (
            <button className="sign-out" type="button" onClick={onLogout}>
              Sign out
            </button>
          ) : null}
        </div>
      </aside>

      <main id="top" className={`workspace workspace-${workspace}`}>
        <header>
          <div>
            <p className="eyebrow">LOCAL PLAYLIST CONTROL</p>
            <h1>{activeWorkspace.title}</h1>
            <p className="subtitle">{activeWorkspace.subtitle}</p>
          </div>
          <span className="environment">LOCAL</span>
        </header>

        {workspace === 'overview' ? (
          <section className="metric-grid" aria-label="IPTVMaster workflow">
            <article className="metric">
              <span className="metric-icon blue">↻</span>
              <div>
                <small>SOURCES</small>
                <strong>Automatic refresh</strong>
                <p>Encrypted provider connections</p>
              </div>
            </article>
            <article className="metric">
              <span className="metric-icon green">+1</span>
              <div>
                <small>TIMEZONE RULE</small>
                <strong>Stockholm → Helsinki</strong>
                <p>Applied only to live-event groups</p>
              </div>
            </article>
            <article className="metric">
              <span className="metric-icon amber">TV</span>
              <div>
                <small>OUTPUT</small>
                <strong>M3U + XMLTV</strong>
                <p>Private URLs for TiviMate</p>
              </div>
            </article>
          </section>
        ) : null}

        <SourceSetup workspace={workspace} />

        {workspace === 'events' ? (
          <section className="content-grid single-panel-grid">
            <article className="panel preview-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">QUICK PREVIEW</p>
                  <h2>Event time preview</h2>
                </div>
                <span className="pill">Europe/Helsinki</span>
              </div>

              <p className="panel-copy">
                Test how an event label from the provider will appear in
                TiviMate. This rule never changes ordinary live-TV channels.
              </p>

              <form onSubmit={preview}>
                <label htmlFor="event-name">Provider event name</label>
                <input
                  id="event-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                />

                <label htmlFor="reference-date">Provider schedule date</label>
                <input
                  id="reference-date"
                  type="date"
                  value={referenceDate}
                  onChange={(event) => setReferenceDate(event.target.value)}
                />

                <button type="submit" disabled={loading}>
                  {loading ? 'Converting…' : 'Preview Finnish time'}
                </button>
              </form>

              {error ? <p className="message error">{error}</p> : null}

              {result ? (
                <div className="result" aria-live="polite">
                  <div>
                    <small>PROVIDER LABEL</small>
                    <p>{result.originalName}</p>
                  </div>
                  <span className="result-arrow">→</span>
                  <div>
                    <small>TIVIMATE LABEL</small>
                    <p>{result.localizedName}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>Source instant</dt>
                      <dd>
                        {displayInstant(
                          result.sourceDateTime,
                          'Europe/Stockholm',
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Finnish instant</dt>
                      <dd>
                        {displayInstant(
                          result.displayDateTime,
                          'Europe/Helsinki',
                        )}
                      </dd>
                    </div>
                  </dl>
                  {result.warning ? (
                    <p className="message warning">{result.warning}</p>
                  ) : null}
                </div>
              ) : null}
            </article>
          </section>
        ) : null}
      </main>
    </div>
  );
}
