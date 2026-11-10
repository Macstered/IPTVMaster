import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  IconClock,
  IconFilm,
  IconGuide,
  IconHistory,
  IconHome,
  IconLink,
  IconPlay,
  IconRows,
  IconServer,
} from './icons.js';

import {
  SourceSetup,
  type LineupView,
  type WorkspaceView,
} from './SourceSetup.js';
import { TOAST_EVENT, type ToastDetail } from './toast.js';
import type { HomeDestination } from './workspaces/HomeWorkspace.js';
import type { SystemStatus } from './workspaces/status.js';

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

const browserTimeZone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const timeZoneChoices: string[] =
  (
    Intl as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf?.('timeZone') ?? [];

function todayInBrowserZone(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value['year']}-${value['month']}-${value['day']}`;
}

const workspaceDetails: Record<
  WorkspaceView,
  { label: string; title: string; subtitle: string; icon: ReactNode }
> = {
  overview: {
    label: 'Home',
    title: 'Home',
    subtitle: '',
    icon: <IconHome />,
  },
  lineup: {
    label: 'Channels',
    title: 'Channels',
    subtitle:
      'Arrange groups and edit the channels that appear in your player.',
    icon: <IconRows />,
  },
  catalogue: {
    label: 'Movies & series',
    title: 'Movies & series',
    subtitle: 'Choose which film and series categories reach your player.',
    icon: <IconFilm />,
  },
  events: {
    label: 'Live events',
    title: 'Live events',
    subtitle:
      'Choose which groups hold daily events and how their times are shown.',
    icon: <IconClock />,
  },
  epg: {
    label: 'Guide',
    title: 'Guide',
    subtitle: 'Give every channel its programme guide.',
    icon: <IconGuide />,
  },
  links: {
    label: 'Player links',
    title: 'Player links',
    subtitle: 'The private links your player loads channels and guide from.',
    icon: <IconLink />,
  },
  providers: {
    label: 'Providers',
    title: 'Providers',
    subtitle:
      'Where channels and guide data come from, and how often they are checked.',
    icon: <IconServer />,
  },
  updates: {
    label: 'History',
    title: 'History',
    subtitle: 'What changed, and a way back to an earlier playlist.',
    icon: <IconHistory />,
  },
};

const plainWorkspaces: readonly WorkspaceView[] = [
  'overview',
  'catalogue',
  'events',
  'epg',
  'links',
  'providers',
  'updates',
];

function routeFromHash(): { workspace: WorkspaceView; lineupView: LineupView } {
  const fragment = window.location.hash.replace(/^#\/?/, '');
  const [head, tail] = fragment.split('/');
  if (head === 'lineup') {
    return {
      workspace: 'lineup',
      lineupView: tail === 'channels' ? 'channels' : 'order',
    };
  }
  const workspace = plainWorkspaces.find((candidate) => candidate === head);
  return { workspace: workspace ?? 'overview', lineupView: 'order' };
}

function hashForRoute(
  workspace: WorkspaceView,
  lineupView: LineupView,
): string {
  return workspace === 'lineup' ? `#/lineup/${lineupView}` : `#/${workspace}`;
}

const primaryNavigation: readonly WorkspaceView[] = [
  'overview',
  'lineup',
  'catalogue',
  'epg',
];
const secondaryNavigation: readonly WorkspaceView[] = [
  'links',
  'providers',
  'updates',
];

const lineupDetails: Record<
  LineupView,
  { label: string; title: string; subtitle: string }
> = {
  order: {
    label: 'Order & visibility',
    title: 'Channels',
    subtitle:
      'Put groups and channels in your order and choose what the player shows.',
  },
  channels: {
    label: 'Group & channel editor',
    title: 'Group & channel editor',
    subtitle:
      'Rename groups and channels, and review what the provider changed.',
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
  // Pages draw their provider picker and their main action into the shell.
  const [switcherSlot, setSwitcherSlot] = useState<HTMLElement | null>(null);
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    function onHashChange() {
      const route = routeFromHash();
      setWorkspace(route.workspace);
      setLineupView(route.lineupView);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [name, setName] = useState(initialEvent);
  const [previewSourceZone, setPreviewSourceZone] = useState('UTC');
  const [referenceDate, setReferenceDate] = useState(todayInBrowserZone());
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/system/status');
      if (!response.ok) return;
      setSystemStatus((await response.json()) as SystemStatus);
    } catch {
      // Status polling is advisory; the workspaces surface real errors.
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    // A background tab still polls otherwise, and every open page costs the
    // server a pass over all channels each minute. Skip while hidden and
    // catch up as soon as the tab is looked at again.
    const handle = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void loadStatus();
    }, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadStatus();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [workspace, loadStatus]);

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
  const inChannels = workspace === 'lineup' || workspace === 'events';

  // On a phone the navigation is one scrolling row; keep the open page in it.
  const currentLink = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    currentLink.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [workspace]);

  function openWorkspace(nextWorkspace: WorkspaceView) {
    setWorkspace(nextWorkspace);
    window.location.hash = hashForRoute(nextWorkspace, lineupView);
    window.scrollTo({ top: 0 });
  }

  function openLineup(nextLineupView: LineupView) {
    setLineupView(nextLineupView);
    setWorkspace('lineup');
    window.location.hash = hashForRoute('lineup', nextLineupView);
    window.scrollTo({ top: 0 });
  }

  function navigate(destination: HomeDestination) {
    if (destination === 'review') openLineup('channels');
    else if (destination === 'guide') openWorkspace('epg');
    else if (destination === 'history') openWorkspace('updates');
    else openWorkspace(destination);
  }

  const channelPages = [
    ...(Object.keys(lineupDetails) as LineupView[]).map((view) => ({
      key: view,
      label: lineupDetails[view].label,
      current: workspace === 'lineup' && lineupView === view,
      open: () => openLineup(view),
    })),
    {
      key: 'events',
      label: workspaceDetails.events.label,
      current: workspace === 'events',
      open: () => openWorkspace('events'),
    },
  ];

  function navigationLink(item: WorkspaceView) {
    const details = workspaceDetails[item];
    const current = item === 'lineup' ? inChannels : workspace === item;
    const pending =
      item === 'lineup'
        ? { count: reviewPendingTotal, what: 'provider changes to review' }
        : item === 'epg'
          ? { count: epgPendingTotal, what: 'channels without guide data' }
          : { count: 0, what: '' };
    return (
      <div className="nav-section" key={item}>
        <button
          className={`nav-link ${current ? 'active' : ''}`}
          type="button"
          ref={current ? currentLink : undefined}
          aria-current={current && item !== 'lineup' ? 'page' : undefined}
          onClick={() =>
            item === 'lineup' ? openLineup(lineupView) : openWorkspace(item)
          }
        >
          <span aria-hidden="true">{details.icon}</span>
          {details.label}
          {pending.count > 0 ? (
            <span
              className="nav-badge"
              title={`${pending.count.toLocaleString()} ${pending.what}`}
            >
              {pending.count.toLocaleString()}
            </span>
          ) : null}
        </button>
        {item === 'lineup' && inChannels ? (
          <div className="nav-submenu">
            {channelPages.map((page) => (
              <button
                className={`nav-submenu-link ${page.current ? 'active' : ''}`}
                type="button"
                aria-current={page.current ? 'page' : undefined}
                onClick={page.open}
                key={page.key}
              >
                {page.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
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
            sourceTimeZone: previewSourceZone,
            displayTimeZone: browserTimeZone,
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
          aria-label="Open IPTVMaster home"
          onClick={() => openWorkspace('overview')}
        >
          <span className="brand-mark">
            <IconPlay width={14} height={14} />
          </span>
          <strong>IPTVMaster</strong>
        </button>

        <div className="provider-slot" ref={setSwitcherSlot} />

        <nav aria-label="Main navigation">
          {primaryNavigation.map(navigationLink)}
          <div className="nav-divider" />
          {secondaryNavigation.map(navigationLink)}
        </nav>

        <div className="sidebar-foot">
          <span>{authUsername ?? 'Local mode'}</span>
          {onLogout ? (
            <button className="sign-out" type="button" onClick={onLogout}>
              Sign out
            </button>
          ) : null}
        </div>
      </aside>

      <main id="top" className={`workspace workspace-${workspace}`}>
        <header className="page-header">
          <div>
            <h1>{activeWorkspace.title}</h1>
            {activeWorkspace.subtitle ? (
              <p className="subtitle">{activeWorkspace.subtitle}</p>
            ) : null}
          </div>
          <div className="page-actions" ref={setActionSlot} />
        </header>

        <SourceSetup
          workspace={workspace}
          lineupView={lineupView}
          status={systemStatus}
          switcherSlot={switcherSlot}
          actionSlot={actionSlot}
          onNavigate={navigate}
          onRefreshStatus={loadStatus}
        />

        {workspace === 'events' ? (
          <section className="content-grid single-panel-grid">
            <article className="panel preview-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">QUICK PREVIEW</p>
                  <h2>Event time preview</h2>
                </div>
                <span className="pill">{browserTimeZone}</span>
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

                <label htmlFor="preview-source-zone">Provider timezone</label>
                <input
                  id="preview-source-zone"
                  list="preview-timezone-choices"
                  value={previewSourceZone}
                  onChange={(event) => setPreviewSourceZone(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <datalist id="preview-timezone-choices">
                  {timeZoneChoices.map((zone) => (
                    <option value={zone} key={zone} />
                  ))}
                </datalist>

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
                      <dt>Provider instant</dt>
                      <dd>
                        {displayInstant(
                          result.sourceDateTime,
                          previewSourceZone,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Localized instant</dt>
                      <dd>
                        {displayInstant(
                          result.displayDateTime,
                          browserTimeZone,
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
