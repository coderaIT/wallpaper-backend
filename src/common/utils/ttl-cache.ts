/**
 * Minimal in-process TTL cache with single-flight loading (concurrent misses share one
 * load). Suitable for small, frequently read documents such as settings and the home feed.
 * Each instance of a horizontally scaled deployment keeps its own copy; the short TTL bounds
 * staleness, so no shared cache (Redis) is required.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();
  /** Bumped by clear(); loads started before a clear must not repopulate the cache. */
  private generation = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100,
  ) {}

  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return loader();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const generation = this.generation;
    const promise = loader()
      .then((value) => {
        if (generation !== this.generation) return value;
        if (this.entries.size >= this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest !== undefined) this.entries.delete(oldest);
        }
        this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.generation++;
    this.entries.clear();
    this.inflight.clear();
  }
}
