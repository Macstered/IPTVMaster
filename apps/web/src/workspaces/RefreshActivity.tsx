import { useEffect, useState } from 'react';

interface RefreshState {
  sourceId: string;
  status: 'running' | 'succeeded' | 'failed' | 'rejected';
  startedAt: string;
  unchanged?: boolean;
  safeError?: string;
  progress?: {
    stage: string;
    elapsedMs: number;
    stageDurationsMs: Record<string, number>;
    processed?: number;
    total?: number;
  };
}

interface ActivityStatus {
  sourceStates: RefreshState[];
  epg: { sourceStates: RefreshState[] };
}

const stageLabels: Record<string, string> = {
  queued: 'Waiting for another update',
  downloading: 'Downloading and reading provider data',
  saving: 'Saving entries',
  reconciling: 'Matching channels and guide data',
  committing: 'Finishing database save',
  completed: 'Completed',
  failed: 'Failed',
};

function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** This endpoint reads in-memory job state; polling never scans the catalogue. */
export function RefreshActivity({
  sources,
}: {
  sources: readonly { id: string; name: string }[];
}) {
  const [status, setStatus] = useState<ActivityStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let loading = false;
    const controller = new AbortController();
    async function load() {
      if (
        loading ||
        controller.signal.aborted ||
        document.visibilityState === 'hidden'
      )
        return;
      loading = true;
      try {
        const response = await fetch('/api/v1/automation/status', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Status unavailable');
        const payload = (await response.json()) as ActivityStatus;
        if (!controller.signal.aborted) {
          setStatus(payload);
          setUnavailable(false);
        }
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    const visible = () => void load();
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  const names = new Map(sources.map((source) => [source.id, source.name]));
  const jobs = [
    ...(status?.sourceStates ?? []).map((job) => ({
      ...job,
      kind: 'Playlist',
    })),
    ...(status?.epg.sourceStates ?? []).map((job) => ({
      ...job,
      kind: 'Guide',
    })),
  ]
    .filter(
      (job) => names.has(job.sourceId) || job.sourceId.startsWith('guide:'),
    )
    .sort(
      (a, b) =>
        Number(b.status === 'running') - Number(a.status === 'running') ||
        b.startedAt.localeCompare(a.startedAt),
    );
  if (!jobs.length && !unavailable) return null;
  return (
    <section className="refresh-activity" aria-label="Refresh progress">
      <h3>Refresh progress</h3>
      <p className="secret-note">
        Elapsed time includes waiting and downloading. Saving counts are not an
        estimate of time remaining.
      </p>
      {unavailable ? (
        <p role="status">
          Progress is temporarily unavailable. The last known state is shown
          below.
        </p>
      ) : null}
      <ul>
        {jobs.map((job) => {
          const progress = job.progress;
          const label =
            job.status === 'rejected'
              ? 'Rejected — previous data kept'
              : job.status === 'failed'
                ? 'Failed — previous data kept'
                : job.status === 'succeeded'
                  ? job.unchanged
                    ? 'Completed — no changes'
                    : 'Completed'
                  : (stageLabels[progress?.stage ?? ''] ?? 'Updating');
          const timings = Object.entries(progress?.stageDurationsMs ?? {})
            .map(
              ([stage, elapsed]) =>
                `${stageLabels[stage] ?? stage}: ${duration(elapsed)}`,
            )
            .join(' · ');
          return (
            <li key={`${job.kind}:${job.sourceId}`}>
              <strong>
                {names.get(job.sourceId) ?? 'Custom guide'} · {job.kind}
              </strong>
              <span>
                {label}
                {progress ? ` · ${duration(progress.elapsedMs)}` : ''}
              </span>
              {progress?.total !== undefined &&
              progress.processed !== undefined ? (
                <small>
                  {progress.processed.toLocaleString()} /{' '}
                  {progress.total.toLocaleString()} entries saved
                </small>
              ) : null}
              {timings ? <small>{timings}</small> : null}
              {job.safeError ? <small>{job.safeError}</small> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
