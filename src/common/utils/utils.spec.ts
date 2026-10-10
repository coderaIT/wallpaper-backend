import { escapeLike } from '../../modules/wallpapers/wallpaper-query.util';
import { deepMerge } from './deep-merge.util';
import { compareVersions } from './semver.util';
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('caches within the TTL and shares concurrent loads', async () => {
    const cache = new TtlCache<number>(60_000);
    const loader = jest.fn(async () => 42);
    const [a, b] = await Promise.all([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)]);
    expect([a, b]).toEqual([42, 42]);
    await cache.getOrLoad('k', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not cache when ttl <= 0', async () => {
    const cache = new TtlCache<number>(0);
    const loader = jest.fn(async () => 1);
    await cache.getOrLoad('k', loader);
    await cache.getOrLoad('k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not let a load that started before clear() repopulate the cache', async () => {
    const cache = new TtlCache<string>(60_000);
    let release!: (v: string) => void;
    const stale = cache.getOrLoad('k', () => new Promise<string>((r) => (release = r)));
    cache.clear();
    release('stale');
    expect(await stale).toBe('stale');
    expect(await cache.getOrLoad('k', async () => 'fresh')).toBe('fresh');
  });

  it('evicts the oldest entry when full', async () => {
    const cache = new TtlCache<string>(60_000, 2);
    await cache.getOrLoad('a', async () => 'a');
    await cache.getOrLoad('b', async () => 'b');
    await cache.getOrLoad('c', async () => 'c');
    const loader = jest.fn(async () => 'a2');
    expect(await cache.getOrLoad('a', loader)).toBe('a2');
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('deepMerge', () => {
  it('merges objects recursively and replaces arrays/primitives', () => {
    const base = { a: { x: 1, y: 2 }, list: [1, 2], s: 'keep' };
    expect(deepMerge(base, { a: { y: 3 }, list: [9] })).toEqual({ a: { x: 1, y: 3 }, list: [9], s: 'keep' });
    expect(base).toEqual({ a: { x: 1, y: 2 }, list: [1, 2], s: 'keep' });
  });

  it('ignores undefined and prototype-pollution keys', () => {
    const patch = JSON.parse('{"a":{"__proto__":{"polluted":true}},"constructor":{"prototype":{"polluted":true}},"b":1}');
    const out = deepMerge({ a: { x: 1 }, c: 2 }, { ...patch, c: undefined }) as Record<string, unknown>;
    expect(out).toEqual({ a: { x: 1 }, b: 1, c: 2 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out, 'constructor')).toBe(false);
  });
});

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.2.0', '1.10.0', -1],
    ['2.0.0', '1.99.99', 1],
    ['1.0', '1.0.0', 0],
  ])('%s vs %s -> %d', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('escapeLike', () => {
  it('escapes LIKE metacharacters', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
    expect(escapeLike('plain')).toBe('plain');
  });
});
