/**
 * Serialises asynchronous work so that each unit runs only after the previous
 * one has settled, preserving submission order regardless of individual
 * durations. Used by {@link Transactor.asyncAdd} and the `saveEach*` helpers.
 */
export class AsyncQueue {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Enqueues `worker`, guaranteeing it starts only after all previously
   * enqueued work has settled. Resolves/rejects with the worker's outcome.
   *
   * @param worker - Produces the work; may return a promise or a value.
   * @param payload - Optional value passed through to the worker.
   */
  run<TPayload, TResult>(
    worker: (payload: TPayload) => TResult | Promise<TResult>,
    payload: TPayload,
  ): Promise<TResult> {
    const next = this.tail.then(() => worker(payload));
    // Keep the chain alive even if this unit rejects, so ordering is preserved.
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
