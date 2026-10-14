import { createHash, randomBytes } from 'node:crypto';

/** 16 hex characters. Clients reuse this value for every page of one browsing session. */
export function createShuffleSeed(): string {
  return randomBytes(8).toString('hex');
}

export function isShuffleSeed(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

/**
 * Deterministic rank used for `sort=random`.
 * PostgreSQL must use the same expression: md5(id::text || ':' || seed).
 * This avoids ORDER BY random(), which would reshuffle every page request.
 */
export function shuffleRank(id: string, seed: string): string {
  return createHash('md5').update(`${id}:${seed}`, 'utf8').digest('hex');
}

export function orderBySeed<T extends { id: string }>(items: readonly T[], seed: string): T[] {
  return [...items].sort((a, b) => {
    const left = shuffleRank(a.id, seed);
    const right = shuffleRank(b.id, seed);
    if (left < right) return -1;
    if (left > right) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

export function pageBySeed<T extends { id: string }>(items: readonly T[], seed: string, page: number, limit: number): T[] {
  const start = Math.max(0, page - 1) * limit;
  return orderBySeed(items, seed).slice(start, start + limit);
}
