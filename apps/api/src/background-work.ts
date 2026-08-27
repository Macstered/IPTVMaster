export type ExclusiveBackgroundRun = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * Keeps database-heavy background cycles from competing for the same disk and
 * row locks. A rejected job does not poison the queue for later work.
 */
export class BackgroundWorkQueue {
  #tail: Promise<void> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
