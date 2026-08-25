import {
  inspectRemotePlaylist,
  SnapshotRejectedError,
  type PlaylistInspection,
} from '@iptvmaster/core';

import type {
  SourceImportPlan,
  SourceRepository,
  StoredSnapshotSummary,
} from './source-repository.js';
import {
  withProviderRetry,
  type ProviderRetryOptions,
} from './provider-retry.js';

export interface PlaylistRefreshResult {
  status: 'completed' | 'already-running';
  sourceId: string;
  startedAt: string;
  finishedAt?: string;
  inspection?: PlaylistInspection;
  snapshot?: StoredSnapshotSummary;
  attempts?: number;
}

export interface PlaylistRefreshState {
  sourceId: string;
  status: 'running' | 'succeeded' | 'failed' | 'rejected';
  startedAt: string;
  finishedAt?: string;
  safeError?: string;
  unchanged?: boolean;
  liveCount?: number;
  attempts?: number;
}

export class SourceNotFoundError extends Error {}

export function safeRefreshError(error: unknown): string {
  if (error instanceof SnapshotRejectedError) return error.message;
  const message =
    error instanceof Error ? error.message : 'Unknown refresh error';
  return message
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/(username|password)=([^&\s]+)/gi, '$1=[redacted]')
    .slice(0, 500);
}

export class PlaylistRefreshCoordinator {
  readonly #repository: SourceRepository;
  readonly #inspector: (
    playlistUrl: string,
    plan?: SourceImportPlan,
  ) => Promise<PlaylistInspection>;
  readonly #retryOptions: Partial<ProviderRetryOptions>;
  readonly #running = new Map<string, Promise<PlaylistRefreshResult>>();
  readonly #states = new Map<string, PlaylistRefreshState>();

  constructor(
    repository: SourceRepository,
    inspector: (
      playlistUrl: string,
      plan?: SourceImportPlan,
    ) => Promise<PlaylistInspection> = (playlistUrl, plan) =>
      inspectRemotePlaylist(
        playlistUrl,
        plan
          ? {
              selectiveGroups: plan.selectiveGroups,
              includeLive: plan.includeLive,
            }
          : {},
      ),
    retryOptions: Partial<ProviderRetryOptions> = {},
  ) {
    this.#repository = repository;
    this.#inspector = inspector;
    this.#retryOptions = retryOptions;
  }

  async refresh(sourceId: string): Promise<PlaylistRefreshResult> {
    if (this.#running.has(sourceId)) {
      const state = this.#states.get(sourceId);
      return {
        status: 'already-running',
        sourceId,
        startedAt: state?.startedAt ?? new Date().toISOString(),
      };
    }

    const refresh = this.#execute(sourceId);
    this.#running.set(sourceId, refresh);
    try {
      return await refresh;
    } finally {
      this.#running.delete(sourceId);
    }
  }

  listStates(): PlaylistRefreshState[] {
    return [...this.#states.values()].sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId),
    );
  }

  async #execute(sourceId: string): Promise<PlaylistRefreshResult> {
    const startedAt = new Date().toISOString();
    let attempts = 0;
    this.#states.set(sourceId, { sourceId, status: 'running', startedAt });
    try {
      const credentials = await this.#repository.getSourceCredentials(sourceId);
      if (!credentials) throw new SourceNotFoundError('Source not found');
      // Read before fetching: the parser needs to know what to retain while it
      // streams, because holding a whole catalogue in order to filter it
      // afterwards is exactly what this avoids.
      const plan = await this.#repository.getImportPlan?.(sourceId);
      const inspection = await withProviderRetry(() => {
        attempts += 1;
        return this.#inspector(credentials.playlistUrl, plan);
      }, this.#retryOptions);
      const snapshot = await this.#repository.savePlaylistSnapshot(
        sourceId,
        inspection,
      );
      const finishedAt = new Date().toISOString();
      this.#states.set(sourceId, {
        sourceId,
        status: 'succeeded',
        startedAt,
        finishedAt,
        unchanged: snapshot.unchanged,
        liveCount: snapshot.liveCount,
        attempts,
      });
      return {
        status: 'completed',
        sourceId,
        startedAt,
        finishedAt,
        inspection,
        snapshot,
        attempts,
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      this.#states.set(sourceId, {
        sourceId,
        status: error instanceof SnapshotRejectedError ? 'rejected' : 'failed',
        startedAt,
        finishedAt,
        safeError: safeRefreshError(error),
        attempts,
      });
      throw error;
    }
  }
}

export interface PlaylistSchedulerLogger {
  info(values: Record<string, unknown>, message: string): void;
  warn(values: Record<string, unknown>, message: string): void;
}

export interface PlaylistSchedulerOptions {
  intervalMs: number;
  initialDelayMs: number;
}

export interface PlaylistSchedulerStatus {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  nextRunAt?: string;
  lastCycleStartedAt?: string;
  lastCycleFinishedAt?: string;
  sourceStates: PlaylistRefreshState[];
}

export class PlaylistScheduler {
  readonly #repository: SourceRepository;
  readonly #coordinator: PlaylistRefreshCoordinator;
  readonly #logger: PlaylistSchedulerLogger;
  #options: PlaylistSchedulerOptions;
  #timer?: NodeJS.Timeout;
  #cyclePromise?: Promise<void>;
  #started = false;
  #running = false;
  #nextRunAt?: string;
  #lastCycleStartedAt?: string;
  #lastCycleFinishedAt?: string;

  constructor(
    repository: SourceRepository,
    coordinator: PlaylistRefreshCoordinator,
    logger: PlaylistSchedulerLogger,
    options: PlaylistSchedulerOptions,
  ) {
    this.#repository = repository;
    this.#coordinator = coordinator;
    this.#logger = logger;
    this.#options = { ...options };
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#schedule(this.#options.initialDelayMs);
  }

  async stop(): Promise<void> {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#nextRunAt = undefined;
    await this.#cyclePromise;
  }

  /**
   * Applies a scheduling change without a restart. A pending run is re-armed
   * from now against the new interval, so shortening it takes effect
   * immediately rather than after the previous, longer wait.
   */
  reconfigure(settings: { intervalMs?: number; enabled?: boolean }): void {
    if (settings.intervalMs !== undefined && settings.intervalMs > 0) {
      this.#options.intervalMs = settings.intervalMs;
      if (this.#started && this.#timer) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#schedule(settings.intervalMs);
      }
    }
    if (settings.enabled === true && !this.#started) this.start();
    if (settings.enabled === false && this.#started) void this.stop();
  }

  status(): PlaylistSchedulerStatus {
    return {
      enabled: this.#started,
      running: this.#running,
      intervalMinutes: this.#options.intervalMs / 60_000,
      ...(this.#nextRunAt ? { nextRunAt: this.#nextRunAt } : {}),
      ...(this.#lastCycleStartedAt
        ? { lastCycleStartedAt: this.#lastCycleStartedAt }
        : {}),
      ...(this.#lastCycleFinishedAt
        ? { lastCycleFinishedAt: this.#lastCycleFinishedAt }
        : {}),
      sourceStates: this.#coordinator.listStates(),
    };
  }

  async runNow(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#lastCycleStartedAt = new Date().toISOString();
    try {
      const sources = await this.#repository.listSources();
      for (const source of sources.filter((candidate) => candidate.enabled)) {
        try {
          const result = await this.#coordinator.refresh(source.id);
          this.#logger.info(
            {
              sourceId: source.id,
              unchanged: result.snapshot?.unchanged,
              liveCount: result.snapshot?.liveCount,
              skipped: result.status === 'already-running',
            },
            'Automatic playlist refresh finished',
          );
        } catch (error) {
          this.#logger.warn(
            { sourceId: source.id, safeError: safeRefreshError(error) },
            'Automatic playlist refresh failed',
          );
        }
      }
    } finally {
      this.#running = false;
      this.#lastCycleFinishedAt = new Date().toISOString();
    }
  }

  #schedule(delayMs: number): void {
    if (!this.#started) return;
    this.#nextRunAt = new Date(Date.now() + delayMs).toISOString();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#nextRunAt = undefined;
      const cycle = this.runNow().catch((error: unknown) => {
        this.#logger.warn(
          { safeError: safeRefreshError(error) },
          'Automatic playlist refresh cycle failed',
        );
      });
      this.#cyclePromise = cycle;
      void cycle.finally(() => {
        if (this.#cyclePromise === cycle) this.#cyclePromise = undefined;
        this.#schedule(this.#options.intervalMs);
      });
    }, delayMs);
    this.#timer.unref();
  }
}
