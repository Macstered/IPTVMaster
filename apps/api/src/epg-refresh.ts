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

  async refreshEpgSource(epgSourceId: string): Promise<EpgRefreshResult> {
    const key = `guide:${epgSourceId}`;
    if (this.#running.has(key)) {
      return {
        status: 'already-running',
        sourceId: key,
        startedAt: this.#states.get(key)?.startedAt ?? new Date().toISOString(),
      };
    }
    const refresh = this.#executeEpgSource(key, epgSourceId);
    this.#running.set(key, refresh);
    try {
      return await refresh;
    } finally {
      this.#running.delete(key);
    }
  }

  async #executeEpgSource(
    key: string,
    epgSourceId: string,
  ): Promise<EpgRefreshResult> {
    const startedAt = new Date().toISOString();
    let attempts = 0;
    this.#states.set(key, { sourceId: key, status: 'running', startedAt });
    try {
      const target =
        await this.#repository.getEpgSourceRefreshTarget(epgSourceId);
      if (!target?.epgUrl) {
        throw new EpgNotConfiguredError('EPG source has no XMLTV URL');
      }
      const inspection = await withProviderRetry(() => {
        attempts += 1;
        return this.#inspector(target.epgUrl!);
      }, this.#retryOptions);
      const summary =
        target.kind === 'provider' && target.ownerSourceId
          ? await this.#repository.saveEpgSnapshot(
              target.ownerSourceId,
              inspection,
            )
          : await this.#repository.saveEpgSnapshotForEpgSource(
              epgSourceId,
              inspection,
            );
      const finishedAt = new Date().toISOString();
      this.#states.set(key, {
        sourceId: key,
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
        sourceId: key,
        startedAt,
        finishedAt,
        inspection,
        summary,
        attempts,
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      this.#states.set(key, {
        sourceId: key,
        status: error instanceof SnapshotRejectedError ? 'rejected' : 'failed',
        startedAt,
        finishedAt,
        safeError: safeRefreshError(error),
        attempts,
      });
      throw error;
    }
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
  #intervalMs: number;
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

  /**
   * Applies a scheduling change without a restart. A pending run is re-armed
   * from now against the new interval, so shortening it takes effect
   * immediately rather than after the previous, longer wait.
   */
  reconfigure(settings: { intervalMs?: number; enabled?: boolean }): void {
    if (settings.intervalMs !== undefined && settings.intervalMs > 0) {
      this.#intervalMs = settings.intervalMs;
      if (this.#started && this.#timer) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#schedule(settings.intervalMs);
      }
    }
    if (settings.enabled === true && !this.#started) this.start();
    if (settings.enabled === false && this.#started) void this.stop();
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
      try {
        const guides = await this.#repository.listEpgSources();
        for (const guide of guides.filter(
          (candidate) => candidate.kind === 'custom' && candidate.enabled,
        )) {
          try {
            const result = await this.#coordinator.refreshEpgSource(guide.id);
            this.#logger.info(
              {
                epgSourceId: guide.id,
                unchanged: result.summary?.unchanged,
                programmeCount: result.summary?.programmeCount,
                skipped: result.status === 'already-running',
              },
              'Automatic custom EPG refresh finished',
            );
          } catch (error) {
            this.#logger.warn(
              { epgSourceId: guide.id, safeError: safeRefreshError(error) },
              'Automatic custom EPG refresh failed',
            );
          }
        }
      } catch (error) {
        this.#logger.warn(
          { safeError: safeRefreshError(error) },
          'Could not list EPG sources for automatic refresh',
        );
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
