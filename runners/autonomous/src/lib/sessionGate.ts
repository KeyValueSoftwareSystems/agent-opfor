// Per-threadId async mutex. Serializes concurrent sends on the SAME threadId for ALL target modes:
// a stateful target's one shared server session corrupts under interleaving, and a stateless thread's
// shared `history` array races if two follow-ups drive it at once. Distinct threadIds never contend
// (the intended pattern: parallel exploration = distinct forked threadIds), so this only bites
// accidental same-id concurrency.

export class SessionGate {
  private tails = new Map<string, Promise<void>>();

  /**
   * Run `fn` exclusively with respect to other calls sharing the same `threadId`. Calls on distinct
   * threadIds run concurrently. Returns `fn`'s result; the lock is released even if `fn` throws.
   */
  async run<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    // The next caller on this threadId waits for us to finish (success or failure).
    this.tails.set(
      threadId,
      prior.then(() => mine)
    );
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
