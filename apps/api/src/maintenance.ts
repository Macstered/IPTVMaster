import { safeRefreshError } from './playlist-refresh.js';

export interface MaintenanceTask {
  cleanupExpiredSessions(): Promise<number>;
}

export interface MaintenanceLogger {
  info(values: Record<string, unknown>, message: string): void;
  warn(values: Record<string, unknown>, message: string): void;
}

export interface MaintenanceStatus {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  nextRunAt?: string;
  lastRunStartedAt?: string;
  lastRunFinishedAt?: string;
  lastExpiredSessionsRemoved?: number;
  lastSafeError?: string;
}

export class MaintenanceScheduler {
  readonly #task: MaintenanceTask;
  readonly #logger: MaintenanceLogger;
  readonly #intervalMs: number;
  readonly #initialDelayMs: number;
  #timer?: NodeJS.Timeout;
  #runPromise?: Promise<void>;
  #started = false;
  #running = false;
  #nextRunAt?: string;
  #lastRunStartedAt?: string;
  #lastRunFinishedAt?: string;
  #lastExpiredSessionsRemoved?: number;
  #lastSafeError?: string;

  constructor(
    task: MaintenanceTask,
    logger: MaintenanceLogger,
    options: { intervalMs: number; initialDelayMs: number },
  ) {
    this.#task = task;
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
    await this.#runPromise;
  }

  status(): MaintenanceStatus {
    return {
      enabled: this.#started,
      running: this.#running,
      intervalMinutes: this.#intervalMs / 60_000,
      ...(this.#nextRunAt ? { nextRunAt: this.#nextRunAt } : {}),
      ...(this.#lastRunStartedAt
        ? { lastRunStartedAt: this.#lastRunStartedAt }
        : {}),
      ...(this.#lastRunFinishedAt
        ? { lastRunFinishedAt: this.#lastRunFinishedAt }
        : {}),
      ...(this.#lastExpiredSessionsRemoved !== undefined
        ? { lastExpiredSessionsRemoved: this.#lastExpiredSessionsRemoved }
        : {}),
      ...(this.#lastSafeError ? { lastSafeError: this.#lastSafeError } : {}),
    };
  }

  async runNow(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#lastRunStartedAt = new Date().toISOString();
    this.#lastSafeError = undefined;
    try {
      const expiredSessionsRemoved = await this.#task.cleanupExpiredSessions();
      this.#lastExpiredSessionsRemoved = expiredSessionsRemoved;
      this.#logger.info(
        { expiredSessionsRemoved },
        'Database maintenance finished',
      );
    } catch (error) {
      this.#lastSafeError = safeRefreshError(error);
      this.#logger.warn(
        { safeError: this.#lastSafeError },
        'Database maintenance failed',
      );
    } finally {
      this.#running = false;
      this.#lastRunFinishedAt = new Date().toISOString();
    }
  }

  #schedule(delayMs: number): void {
    if (!this.#started) return;
    this.#nextRunAt = new Date(Date.now() + delayMs).toISOString();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#nextRunAt = undefined;
      const run = this.runNow();
      this.#runPromise = run;
      void run.finally(() => {
        if (this.#runPromise === run) this.#runPromise = undefined;
        this.#schedule(this.#intervalMs);
      });
    }, delayMs);
    this.#timer.unref();
  }
}
