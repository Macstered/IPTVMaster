export type RefreshStage =
  | 'queued'
  | 'downloading'
  | 'saving'
  | 'reconciling'
  | 'committing'
  | 'completed'
  | 'failed';

export interface RefreshProgressSnapshot {
  stage: RefreshStage;
  elapsedMs: number;
  stageElapsedMs: number;
  stageDurationsMs: Partial<Record<RefreshStage, number>>;
  processed?: number;
  total?: number;
}

export type ReportRefreshProgress = (
  stage: RefreshStage,
  processed?: number,
  total?: number,
) => void;

/** Monotonic, credential-free timings. Counts describe rows, not a guessed ETA. */
export class RefreshProgress {
  readonly #clock: () => number;
  readonly #started: number;
  #stageStarted: number;
  #finished?: number;
  #stage: RefreshStage = 'queued';
  #durations: Partial<Record<RefreshStage, number>> = {};
  #processed?: number;
  #total?: number;

  constructor(clock: () => number = () => performance.now()) {
    this.#clock = clock;
    this.#started = clock();
    this.#stageStarted = this.#started;
  }

  readonly report: ReportRefreshProgress = (stage, processed, total) => {
    if (this.#finished !== undefined) return;
    const now = this.#clock();
    if (stage !== this.#stage) {
      this.#durations[this.#stage] =
        (this.#durations[this.#stage] ?? 0) + now - this.#stageStarted;
      this.#stage = stage;
      this.#stageStarted = now;
    }
    this.#processed = processed;
    this.#total = total;
    if (stage === 'completed' || stage === 'failed') this.#finished = now;
  };

  snapshot(): RefreshProgressSnapshot {
    const now = this.#finished ?? this.#clock();
    const stageElapsedMs = Math.max(0, now - this.#stageStarted);
    const durations = { ...this.#durations };
    durations[this.#stage] = (durations[this.#stage] ?? 0) + stageElapsedMs;
    return {
      stage: this.#stage,
      elapsedMs: Math.round(Math.max(0, now - this.#started)),
      stageElapsedMs: Math.round(stageElapsedMs),
      stageDurationsMs: Object.fromEntries(
        Object.entries(durations).map(([key, value]) => [
          key,
          Math.round(value),
        ]),
      ),
      ...(this.#processed === undefined ? {} : { processed: this.#processed }),
      ...(this.#total === undefined ? {} : { total: this.#total }),
    };
  }
}
