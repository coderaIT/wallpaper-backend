export interface CategoryWallpaperFact {
  wallpaperId: string;
  mediaId: string;
  /** Number of categories this wallpaper belongs to, including the one being deleted. */
  categoryCount: number;
}

export interface MediaReferenceFact {
  mediaId: string;
  otherWallpapers: number;
  otherCategoryCovers: number;
  banners: number;
}

export interface CategoryDeletionPlan {
  associatedWallpapers: number;
  exclusiveWallpapers: number;
  sharedWallpapers: number;
  mediaEligibleForCleanup: number;
  exclusiveWallpaperIds: string[];
  sharedWallpaperIds: string[];
  mediaIdsEligibleForCleanup: string[];
}

/**
 * A wallpaper is exclusive only when its sole category is the one being deleted.
 * Shared wallpapers stay. Media is eligible only when nothing else still references it.
 */
export function planCategoryDeletion(wallpapers: readonly CategoryWallpaperFact[], media: readonly MediaReferenceFact[]): CategoryDeletionPlan {
  const unique = new Map<string, CategoryWallpaperFact>();
  for (const row of wallpapers) {
    if (!unique.has(row.wallpaperId)) unique.set(row.wallpaperId, row);
  }
  const rows = [...unique.values()];
  const exclusive = rows.filter((row) => row.categoryCount === 1);
  const shared = rows.filter((row) => row.categoryCount > 1);
  const mediaById = new Map(media.map((row) => [row.mediaId, row]));
  const eligible = exclusive.filter((row) => {
    const usage = mediaById.get(row.mediaId);
    if (!usage) return true;
    return usage.otherWallpapers === 0 && usage.otherCategoryCovers === 0 && usage.banners === 0;
  });
  return {
    associatedWallpapers: rows.length,
    exclusiveWallpapers: exclusive.length,
    sharedWallpapers: shared.length,
    mediaEligibleForCleanup: new Set(eligible.map((row) => row.mediaId)).size,
    exclusiveWallpaperIds: exclusive.map((row) => row.wallpaperId),
    sharedWallpaperIds: shared.map((row) => row.wallpaperId),
    mediaIdsEligibleForCleanup: [...new Set(eligible.map((row) => row.mediaId))],
  };
}

/** Second check under row locks. Count must still be exactly one. */
export function idsStillExclusive(rows: readonly { id: string; categoryCount: number }[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    if (row.categoryCount !== 1 || seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  return ids;
}
