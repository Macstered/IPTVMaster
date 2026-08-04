import {
  inspectRemotePlaylist,
  SnapshotRejectedError,
  type PlaylistInspection,
} from '@iptvmaster/core';

import type {
  SourceRepository,
  StoredSnapshotSummary,
} from './source-repository.js';

export interface PlaylistRefreshResult {
  status: 'completed' | 'already-running';
  sourceId: string;
  startedAt: string;
  finishedAt?: string;
  inspection?: PlaylistInspection;
  snapshot?: StoredSnapshotSummary;
}

export interface PlaylistRefreshState {
  sourceId: string;
  status: 'running' | 'succeeded' | 'failed' | 'rejected';
  startedAt: string;
  finishedAt?: string;
  safeError?: string;
  unchanged?: boolean;
  liveCount?: number;
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
  readonly #inspector: (playlistUrl: string) => Promise<PlaylistInspection>;
  readonly #running = new Map<string, Promise<PlaylistRefreshResult>>();
  readonly #states = new Map<string, PlaylistRefreshState>();

  constructor(
    repository: SourceRepository,
    inspector: (
      playlistUrl: string,
    ) => Promise<PlaylistInspection> = inspectRemotePlaylist,
  ) {
    this.#repository = repository;
    this.#inspector = inspector;
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
    this.#states.set(sourceId, { sourceId, status: 'running', startedAt });
    try {
      const credentials = await this.#repository.getSourceCredentials(sourceId);
      if (!credentials) throw new SourceNotFoundError('Source not found');
      const inspection = await this.#inspector(credentials.playlistUrl);
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
      });
      return {
        status: 'completed',
        sourceId,
        startedAt,
        finishedAt,
        inspection,
        snapshot,
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      this.#states.set(sourceId, {
        sourceId,
        status: error instanceof SnapshotRejectedError ? 'rejected' : 'failed',
        startedAt,
        finishedAt,
        safeError: safeRefreshError(error),
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
  readonly #options: PlaylistSchedulerOptions;
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
    this.#options = options;
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
