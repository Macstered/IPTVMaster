import {
  inspectRemoteXmltv,
  SnapshotRejectedError,
  type XmltvInspection,
} from '@iptvmaster/core';

import {
  safeRefreshError,
  type PlaylistSchedulerLogger,
} from './playlist-refresh.js';
import type {
  SourceRepository,
  StoredEpgSummary,
} from './source-repository.js';
import {
  withProviderRetry,
  type ProviderRetryOptions,
} from './provider-retry.js';

export class EpgNotConfiguredError extends Error {}

export interface EpgRefreshResult {
  status: 'completed' | 'already-running';
  sourceId: string;
  startedAt: string;
  finishedAt?: string;
  inspection?: XmltvInspection;
  summary?: StoredEpgSummary;
  attempts?: number;
}

export interface EpgRefreshState {
  sourceId: string;
  status: 'running' | 'succeeded' | 'failed' | 'rejected';
  startedAt: string;
  finishedAt?: string;
  safeError?: string;
  unchanged?: boolean;
  channelCount?: number;
  programmeCount?: number;
  attempts?: number;
}

export class EpgRefreshCoordinator {
  readonly #repository: SourceRepository;
  readonly #inspector: (epgUrl: string) => Promise<XmltvInspection>;
  readonly #retryOptions: Partial<ProviderRetryOptions>;
  readonly #running = new Map<string, Promise<EpgRefreshResult>>();
  readonly #states = new Map<string, EpgRefreshState>();

  constructor(
    repository: SourceRepository,
    inspector: (
      epgUrl: string,
    ) => Promise<XmltvInspection> = inspectRemoteXmltv,
    retryOptions: Partial<ProviderRetryOptions> = {},
  ) {
    this.#repository = repository;
    this.#inspector = inspector;
    this.#retryOptions = retryOptions;
  }

  async refresh(sourceId: string): Promise<EpgRefreshResult> {
    if (this.#running.has(sourceId)) {
      return {
        status: 'already-running',
        sourceId,
        startedAt:
          this.#states.get(sourceId)?.startedAt ?? new Date().toISOString(),
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

  listStates(): EpgRefreshState[] {
    return [...this.#states.values()].sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId),
    );
  }

  async #execute(sourceId: string): Promise<EpgRefreshResult> {
    const startedAt = new Date().toISOString();
    let attempts = 0;
    this.#states.set(sourceId, { sourceId, status: 'running', startedAt });
    try {
      const credentials = await this.#repository.getSourceCredentials(sourceId);
      if (!credentials?.epgUrl) {
        throw new EpgNotConfiguredError('Source has no XMLTV URL');
      }
      const inspection = await withProviderRetry(() => {
        attempts += 1;
        return this.#inspector(credentials.epgUrl!);
      }, this.#retryOptions);
      const summary = await this.#repository.saveEpgSnapshot(
        sourceId,
        inspection,
      );
      const finishedAt = new Date().toISOString();
      this.#states.set(sourceId, {
        sourceId,
        status: 'succeeded',
        startedAt,
        finishedAt,
        unchanged: summary.unchanged,
        channelCount: summary.channelCount,
        programmeCount: summary.programmeCount,
        attempts,
      });
      return {
        status: 'completed',
        sourceId,
        startedAt,
        finishedAt,
        inspection,
        summary,
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

export interface EpgSchedulerStatus {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  nextRunAt?: string;
  lastCycleStartedAt?: string;
  lastCycleFinishedAt?: string;
  sourceStates: EpgRefreshState[];
}

export class EpgScheduler {
  readonly #repository: SourceRepository;
  readonly #coordinator: EpgRefreshCoordinator;
  readonly #logger: PlaylistSchedulerLogger;
  readonly #intervalMs: number;
  readonly #initialDelayMs: number;
  #timer?: NodeJS.Timeout;
  #cyclePromise?: Promise<void>;
  #started = false;
  #running = false;
  #nextRunAt?: string;
  #lastCycleStartedAt?: string;
  #lastCycleFinishedAt?: string;

  constructor(
    repository: SourceRepository,
    coordinator: EpgRefreshCoordinator,
    logger: PlaylistSchedulerLogger,
    options: { intervalMs: number; initialDelayMs: number },
  ) {
    this.#repository = repository;
    this.#coordinator = coordinator;
    this.#logger = logger;
    this.#intervalMs = options.intervalMs;
    this.#initialDelayMs = options.initialDelayMs;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#schedule(this.#initialDelayMs);
  }

  async stop(): Promise<void> {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#nextRunAt = undefined;
    await this.#cyclePromise;
  }

  status(): EpgSchedulerStatus {
    return {
      enabled: this.#started,
      running: this.#running,
      intervalMinutes: this.#intervalMs / 60_000,
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
      for (const source of sources.filter(
        (candidate) => candidate.enabled && candidate.hasEpgUrl,
      )) {
        try {
          const result = await this.#coordinator.refresh(source.id);
          this.#logger.info(
            {
              sourceId: source.id,
              unchanged: result.summary?.unchanged,
              programmeCount: result.summary?.programmeCount,
              skipped: result.status === 'already-running',
            },
            'Automatic EPG refresh finished',
          );
        } catch (error) {
          this.#logger.warn(
            { sourceId: source.id, safeError: safeRefreshError(error) },
            'Automatic EPG refresh failed',
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
          'Automatic EPG refresh cycle failed',
        );
      });
      this.#cyclePromise = cycle;
      void cycle.finally(() => {
        if (this.#cyclePromise === cycle) this.#cyclePromise = undefined;
        this.#schedule(this.#intervalMs);
      });
    }, delayMs);
    this.#timer.unref();
  }
}
