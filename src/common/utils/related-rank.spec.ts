import { RELATED_CATEGORY_WEIGHT, RELATED_ORIENTATION_WEIGHT, RELATED_TAG_WEIGHT, rankRelated, relatedScore } from './related-rank';

describe('related wallpapers', () => {
  it('prefers the same category, then shared tags, then orientation', () => {
    expect(relatedScore({ sharedCategories: 2, sharedTags: 0, sameOrientation: false })).toBe(RELATED_CATEGORY_WEIGHT);
    expect(relatedScore({ sharedCategories: 0, sharedTags: 2, sameOrientation: true })).toBe(RELATED_TAG_WEIGHT * 2 + RELATED_ORIENTATION_WEIGHT);
    const page = rankRelated(
      'self',
      [
        { id: 'other', sharedCategories: 0, sharedTags: 0, sameOrientation: false },
        { id: 'self', sharedCategories: 9, sharedTags: 9, sameOrientation: true },
        { id: 'tagged', sharedCategories: 0, sharedTags: 1, sameOrientation: false },
        { id: 'same', sharedCategories: 1, sharedTags: 0, sameOrientation: false },
        { id: 'same', sharedCategories: 1, sharedTags: 3, sameOrientation: true },
      ],
      1,
      10,
    );
    expect(page.map((item) => item.id)).toEqual(['same', 'tagged', 'other']);
  });

  it('pages without repeating ids and keeps zero-score fallbacks', () => {
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      id: `w-${index}`,
      sharedCategories: 0,
      sharedTags: 0,
      sameOrientation: false,
    }));
    const first = rankRelated('missing', candidates, 1, 2);
    const second = rankRelated('missing', candidates, 2, 2);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(new Set([...first, ...second].map((item) => item.id)).size).toBe(4);
  });
});
