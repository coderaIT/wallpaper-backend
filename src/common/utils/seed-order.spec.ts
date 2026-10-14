import { createShuffleSeed, isShuffleSeed, pageBySeed, shuffleRank } from './seed-order';

describe('seed ordering', () => {
  const items = Array.from({ length: 25 }, (_, index) => ({ id: `wallpaper-${String(index).padStart(2, '0')}` }));

  it('does not repeat records across pages of the same seed', () => {
    const seed = 'abc12345';
    const first = pageBySeed(items, seed, 1, 10);
    const second = pageBySeed(items, seed, 2, 10);
    const third = pageBySeed(items, seed, 3, 10);
    const ids = [...first, ...second, ...third].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(25);
    expect(pageBySeed(items, seed, 1, 10).map((item) => item.id)).toEqual(first.map((item) => item.id));
  });

  it('changes the sequence when the seed changes and keeps a stable rank', () => {
    const left = pageBySeed(items, 'seed-one1', 1, 25).map((item) => item.id);
    const right = pageBySeed(items, 'seed-two2', 1, 25).map((item) => item.id);
    expect(left).not.toEqual(right);
    expect(shuffleRank('wallpaper-01', 'seed-one1')).toBe(shuffleRank('wallpaper-01', 'seed-one1'));
  });

  it('creates an acceptable seed', () => {
    const seed = createShuffleSeed();
    expect(isShuffleSeed(seed)).toBe(true);
    expect(isShuffleSeed('short')).toBe(false);
    expect(isShuffleSeed('bad seed!')).toBe(false);
  });
});
