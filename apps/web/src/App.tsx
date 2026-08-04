import { type FormEvent, useState } from 'react';

import { SourceSetup } from './SourceSetup.js';

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

export function App() {
  const [name, setName] = useState(initialEvent);
  const [referenceDate, setReferenceDate] = useState('2026-08-04');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        <a className="brand" href="#top" aria-label="IPTVMaster home">
          <span className="brand-mark">IM</span>
          <span>
            <strong>IPTVMaster</strong>
            <small>Local playlist control</small>
          </span>
        </a>

        <nav aria-label="Main navigation">
          <a className="nav-link active" href="#dashboard">
            <span>⌂</span> Dashboard
          </a>
          <a className="nav-link" href="#channels">
            <span>▤</span> Channels <em>ready</em>
          </a>
          <a className="nav-link" href="#updates">
            <span>↻</span> Updates <em>ready</em>
          </a>
          <a className="nav-link muted" href="#events">
            <span>◷</span> Live events <em>soon</em>
          </a>
          <a className="nav-link muted" href="#guide">
            <span>▦</span> EPG mappings <em>soon</em>
          </a>
        </nav>

        <div className="status-card">
          <span className="status-dot" />
          <div>
            <strong>Foundation running</strong>
            <small>Provider not configured</small>
          </div>
        </div>
      </aside>

      <main id="top">
        <header>
          <div>
            <p className="eyebrow">MVP FOUNDATION</p>
            <h1>Good evening</h1>
            <p className="subtitle">
              Build and verify your local TiviMate lineup.
            </p>
          </div>
          <span className="environment">LOCAL</span>
        </header>

        <section
          className="metric-grid"
          id="dashboard"
          aria-label="Project status"
        >
          <article className="metric">
            <span className="metric-icon blue">↻</span>
            <div>
              <small>SOURCE SYNC</small>
              <strong>Not configured</strong>
              <p>Credentials stay local</p>
            </div>
          </article>
          <article className="metric">
            <span className="metric-icon green">✓</span>
            <div>
              <small>TIMEZONE RULE</small>
              <strong>Stockholm → Helsinki</strong>
              <p>Event groups only</p>
            </div>
          </article>
          <article className="metric">
            <span className="metric-icon amber">◌</span>
            <div>
              <small>OUTPUT</small>
              <strong>Awaiting setup</strong>
              <p>M3U + XMLTV for TiviMate</p>
            </div>
          </article>
        </section>

        <SourceSetup />

        <section className="content-grid">
          <article className="panel preview-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">FIRST WORKING SLICE</p>
                <h2>Event time preview</h2>
              </div>
              <span className="pill">Europe/Helsinki</span>
            </div>

            <p className="panel-copy">
              Test how an event label from the provider will appear in TiviMate.
              This rule never changes ordinary live-TV channels.
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

          <aside className="panel roadmap-card">
            <p className="eyebrow">BUILD PROGRESS</p>
            <h2>Foundation</h2>
            <ol>
              <li className="done">
                <span>1</span>
                <div>
                  <strong>Repository safety</strong>
                  <small>Secrets and provider data excluded</small>
                </div>
              </li>
              <li className="done">
                <span>2</span>
                <div>
                  <strong>Streaming parser</strong>
                  <small>Live and VOD classification</small>
                </div>
              </li>
              <li className="active">
                <span>3</span>
                <div>
                  <strong>Event policies</strong>
                  <small>Timezone and placeholder rules</small>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>Persistent editor</strong>
                  <small>Database and channel overrides</small>
                </div>
              </li>
              <li>
                <span>5</span>
                <div>
                  <strong>TiviMate output</strong>
                  <small>Stable M3U and XMLTV endpoints</small>
                </div>
              </li>
            </ol>
          </aside>
        </section>
      </main>
    </div>
  );
}
