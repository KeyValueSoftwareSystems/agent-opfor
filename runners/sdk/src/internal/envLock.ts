let last: Promise<void> = Promise.resolve();

/**
 * Serialize code paths that temporarily mutate `process.env`.
 *
 * The SDK sets provider API keys into env vars for compatibility with core.
 * If two calls overlap in one process, they can clobber each other’s env.
 */
export async function withEnvLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });

  const prev = last;
  last = prev.then(() => next);

  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}
