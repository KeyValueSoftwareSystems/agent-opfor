/**
 * Per-key async mutex. Serializes concurrent async operations that share the
 * same key (e.g. threadId, sessionId). Calls on distinct keys run concurrently.
 *
 * Useful anywhere concurrent sends share a session/thread: autonomous runner
 * threads, core multi-turn HTTP targets, future runners.
 */
export class SessionGate {
  private tails = new Map<string, Promise<void>>();

  /**
   * Run `fn` exclusively with respect to other calls sharing the same `key`.
   * Calls on distinct keys run concurrently. Returns `fn`'s result; the lock
   * is released even if `fn` throws.
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.tails.set(
      key,
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
