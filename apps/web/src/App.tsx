import { type FormEvent, type ReactNode, useEffect, useState } from 'react';

import {
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconGuide,
  IconHistory,
  IconHome,
  IconPlay,
  IconRows,
} from './icons.js';

import {
  SourceSetup,
  type LineupView,
  type WorkspaceView,
} from './SourceSetup.js';
import { TOAST_EVENT, type ToastDetail } from './toast.js';
import {
  OverviewStatus,
  type SystemStatus,
} from './workspaces/OverviewStatus.js';

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
  { label: string; title: string; subtitle: string; icon: ReactNode }
> = {
  overview: {
    label: 'Overview',
    title: 'Playlist overview',
    subtitle: 'Manage providers, refresh sources, and copy your player URLs.',
    icon: <IconHome />,
  },
  lineup: {
    label: 'Lineup',
    title: 'Lineup editor',
    subtitle:
      'Arrange groups and edit the channels that appear in your player.',
    icon: <IconRows />,
  },
  events: {
    label: 'Live events',
    title: 'Live event rules',
    subtitle: 'Control daily event groups and preview localized event times.',
    icon: <IconClock />,
  },
  epg: {
    label: 'EPG mappings',
    title: 'EPG mapping',
    subtitle:
      'Review guide coverage and resolve channels that need a manual match.',
    icon: <IconGuide />,
  },
  updates: {
    label: 'Updates',
    title: 'Update history',
    subtitle:
      'Review automatic refreshes and restore a retained playlist snapshot.',
    icon: <IconHistory />,
  },
};

function routeFromHash(): { workspace: WorkspaceView; lineupView: LineupView } {
  const fragment = window.location.hash.replace(/^#\/?/, '');
  const [head, tail] = fragment.split('/');
  if (head === 'lineup') {
    return {
      workspace: 'lineup',
      lineupView: tail === 'channels' ? 'channels' : 'order',
    };
  }
  if (
    head === 'overview' ||
    head === 'events' ||
    head === 'epg' ||
    head === 'updates'
  ) {
    return { workspace: head, lineupView: 'order' };
  }
  return { workspace: 'overview', lineupView: 'order' };
}

function hashForRoute(
  workspace: WorkspaceView,
  lineupView: LineupView,
): string {
  return workspace === 'lineup' ? `#/lineup/${lineupView}` : `#/${workspace}`;
}

const workspaceOrder: WorkspaceView[] = [
  'overview',
  'lineup',
  'events',
  'epg',
  'updates',
];

const lineupDetails: Record<
  LineupView,
  { label: string; title: string; subtitle: string }
> = {
  order: {
    label: 'Playlist order',
    title: 'Playlist order',
    subtitle: 'Arrange final playlist groups and sort their channels.',
  },
  channels: {
    label: 'Group & channel editor',
    title: 'Group & channel editor',
    subtitle: 'Edit provider groups, custom categories, and channel details.',
  },
};

function displayInstant(value: string | undefined, timeZone: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(new Date(value));
}

interface ActiveToast extends ToastDetail {
  id: number;
}

let toastSequence = 0;

function ToastRegion() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      const id = ++toastSequence;
      setToasts((current) => [...current, { ...detail, id }]);
      window.setTimeout(
        () => {
          setToasts((current) => current.filter((toast) => toast.id !== id));
        },
        detail.kind === 'error' ? 9000 : 4500,
      );
    }
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

interface AppProps {
  authUsername?: string;
  onLogout?: () => void;
}

export function App({ authUsername, onLogout }: AppProps) {
  const initialRoute = routeFromHash();
  const [workspace, setWorkspace] = useState<WorkspaceView>(
    initialRoute.workspace,
  );
  const [lineupView, setLineupView] = useState<LineupView>(
    initialRoute.lineupView,
  );
  const [lineupMenuOpen, setLineupMenuOpen] = useState(
    initialRoute.workspace === 'lineup',
  );

  useEffect(() => {
    function onHashChange() {
      const route = routeFromHash();
      setWorkspace(route.workspace);
      setLineupView(route.lineupView);
      if (route.workspace === 'lineup') setLineupMenuOpen(true);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [name, setName] = useState(initialEvent);
  const [referenceDate, setReferenceDate] = useState('2026-08-04');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const response = await fetch('/api/v1/system/status');
        if (!response.ok) return;
        const payload = (await response.json()) as SystemStatus;
        if (active) setSystemStatus(payload);
      } catch {
        // Status polling is advisory; the workspaces surface real errors.
      }
    }
    void loadStatus();
    const handle = window.setInterval(() => void loadStatus(), 60_000);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [workspace]);

  const reviewPendingTotal =
    systemStatus?.sources.reduce(
      (total, source) => total + source.reviewPending,
      0,
    ) ?? 0;
  const epgPendingTotal =
    systemStatus?.sources.reduce(
      (total, source) =>
        total + Math.max(source.epgMappable - source.epgMapped, 0),
      0,
    ) ?? 0;
  const activeWorkspace =
    workspace === 'lineup'
      ? { ...workspaceDetails.lineup, ...lineupDetails[lineupView] }
      : workspaceDetails[workspace];

  function openWorkspace(nextWorkspace: WorkspaceView) {
    setWorkspace(nextWorkspace);
    if (nextWorkspace !== 'lineup') setLineupMenuOpen(false);
    window.location.hash = hashForRoute(nextWorkspace, lineupView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openLineup(nextLineupView: LineupView) {
    setLineupView(nextLineupView);
    setLineupMenuOpen(true);
    setWorkspace('lineup');
    window.location.hash = hashForRoute('lineup', nextLineupView);
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
      <ToastRegion />
      <aside className="sidebar">
        <button
          className="brand"
          type="button"
          aria-label="Open IPTVMaster overview"
          onClick={() => openWorkspace('overview')}
        >
          <span className="brand-mark">
            <IconPlay width={18} height={18} />
          </span>
          <span>
            <strong>IPTVMaster</strong>
            <small>Local playlist control</small>
          </span>
        </button>

        <nav aria-label="Main navigation">
          {workspaceOrder.map((item) => {
            const details = workspaceDetails[item];
            if (item === 'lineup') {
              return (
                <div
                  className={`nav-section ${lineupMenuOpen ? 'open' : ''}`}
                  key={item}
                >
                  <button
                    className={`nav-link ${workspace === item ? 'active' : ''}`}
                    type="button"
                    aria-expanded={lineupMenuOpen}
                    onClick={() => {
                      if (workspace !== 'lineup') {
                        openLineup(lineupView);
                      } else {
                        setLineupMenuOpen((current) => !current);
                      }
                    }}
                  >
                    <span aria-hidden="true">{details.icon}</span>
                    {details.label}
                    {reviewPendingTotal > 0 ? (
                      <span
                        className="nav-badge"
                        title={`${reviewPendingTotal} provider changes to review`}
                      >
                        {reviewPendingTotal}
                      </span>
                    ) : null}
                    <span className="nav-chevron" aria-hidden="true">
                      {lineupMenuOpen ? <IconChevronUp /> : <IconChevronDown />}
                    </span>
                  </button>
                  <div className="nav-submenu" hidden={!lineupMenuOpen}>
                    {(Object.keys(lineupDetails) as LineupView[]).map(
                      (subpage) => (
                        <button
                          className={`nav-submenu-link ${
                            workspace === 'lineup' && lineupView === subpage
                              ? 'active'
                              : ''
                          }`}
                          type="button"
                          aria-current={
                            workspace === 'lineup' && lineupView === subpage
                              ? 'page'
                              : undefined
                          }
                          onClick={() => openLineup(subpage)}
                          key={subpage}
                        >
                          <span aria-hidden="true">•</span>
                          {lineupDetails[subpage].label}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              );
            }
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
                {item === 'epg' && epgPendingTotal > 0 ? (
                  <span
                    className="nav-badge"
                    title={`${epgPendingTotal} channels without EPG`}
                  >
                    {epgPendingTotal}
                  </span>
                ) : null}
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
            <h1>{activeWorkspace.title}</h1>
            <p className="subtitle">{activeWorkspace.subtitle}</p>
          </div>
          <span className="environment">LOCAL</span>
        </header>

        {workspace === 'overview' ? (
          <OverviewStatus
            status={systemStatus}
            onOpenLineup={() => openLineup('channels')}
            onOpenEpg={() => openWorkspace('epg')}
          />
        ) : null}

        <SourceSetup workspace={workspace} lineupView={lineupView} />

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
                Test how an event label from the provider will appear in your
                player. This rule never changes ordinary live-TV channels.
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
                  {loading ? 'Converting…' : 'Preview localized time'}
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
                    <small>PLAYER LABEL</small>
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
                      <dt>Localized instant</dt>
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
