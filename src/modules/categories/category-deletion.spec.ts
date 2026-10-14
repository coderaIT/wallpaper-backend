import { idsStillExclusive, planCategoryDeletion } from './category-deletion';

describe('category deletion plan', () => {
  const wallpapers = [
    { wallpaperId: 'exclusive', mediaId: 'media-a', categoryCount: 1 },
    { wallpaperId: 'shared', mediaId: 'media-b', categoryCount: 2 },
    { wallpaperId: 'orphan-file', mediaId: 'media-c', categoryCount: 1 },
    { wallpaperId: 'exclusive', mediaId: 'media-a', categoryCount: 1 },
  ];

  it('separates exclusive, shared, and media that is still referenced', () => {
    const plan = planCategoryDeletion(wallpapers, [
      { mediaId: 'media-a', otherWallpapers: 0, otherCategoryCovers: 0, banners: 0 },
      { mediaId: 'media-b', otherWallpapers: 0, otherCategoryCovers: 0, banners: 0 },
      { mediaId: 'media-c', otherWallpapers: 1, otherCategoryCovers: 0, banners: 1 },
    ]);
    expect(plan.associatedWallpapers).toBe(3);
    expect(plan.exclusiveWallpaperIds).toEqual(['exclusive', 'orphan-file']);
    expect(plan.sharedWallpaperIds).toEqual(['shared']);
    expect(plan.mediaIdsEligibleForCleanup).toEqual(['media-a']);
    expect(plan.mediaEligibleForCleanup).toBe(1);
  });

  it('does not treat a wallpaper that gained another category as exclusive', () => {
    expect(
      idsStillExclusive([
        { id: 'exclusive', categoryCount: 1 },
        { id: 'now-shared', categoryCount: 2 },
        { id: 'exclusive', categoryCount: 1 },
      ]),
    ).toEqual(['exclusive']);
  });

  it('keeps shared wallpapers even when their file looks unused', () => {
    const plan = planCategoryDeletion(
      [{ wallpaperId: 'shared', mediaId: 'media-b', categoryCount: 3 }],
      [{ mediaId: 'media-b', otherWallpapers: 0, otherCategoryCovers: 0, banners: 0 }],
    );
    expect(plan.exclusiveWallpapers).toBe(0);
    expect(plan.sharedWallpapers).toBe(1);
    expect(plan.mediaIdsEligibleForCleanup).toEqual([]);
  });
});
