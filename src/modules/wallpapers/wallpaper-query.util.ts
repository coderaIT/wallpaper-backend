import { Prisma, WallpaperOrientation } from '../../generated/prisma/client';
import { SortDirection } from '../../common/dto/sort.dto';

export function orientationOf(width: number, height: number): WallpaperOrientation {
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= 0.01) return 'SQUARE';
  return ratio > 1 ? 'LANDSCAPE' : 'PORTRAIT';
}

/** Escapes LIKE metacharacters; Prisma's `contains` does not, so `%` / `_` would act as wildcards. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Keyword search on title (trigram-indexed ILIKE) and exact tag match. */
export function wallpaperSearchFilter(search: string, includeDescription: boolean): Prisma.WallpaperWhereInput {
  const term = search.trim();
  const pattern = escapeLike(term);
  return {
    OR: [
      { title: { contains: pattern, mode: 'insensitive' } },
      { tags: { has: term.toLowerCase() } },
      { translations: { some: { title: { contains: pattern, mode: 'insensitive' } } } },
      ...(includeDescription
        ? [
            { description: { contains: pattern, mode: 'insensitive' as const } },
            { translations: { some: { description: { contains: pattern, mode: 'insensitive' as const } } } },
          ]
        : []),
    ],
  };
}

export type WallpaperSortKey = 'createdAt' | 'publishedAt' | 'popularity' | 'downloads' | 'views' | 'sortOrder' | 'title';

/** Maps an allowlisted sort key to a deterministic ORDER BY (id as tie-breaker for stable pagination). */
export function wallpaperOrderBy(sortBy: WallpaperSortKey, dir: SortDirection): Prisma.WallpaperOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'popularity':
      return [{ downloadCount: dir }, { viewCount: dir }, { id: dir }];
    case 'downloads':
      return [{ downloadCount: dir }, { id: dir }];
    case 'views':
      return [{ viewCount: dir }, { id: dir }];
    case 'publishedAt':
      return [{ publishedAt: { sort: dir, nulls: 'last' } }, { id: dir }];
    case 'sortOrder':
      return [{ sortOrder: dir }, { createdAt: 'desc' }, { id: 'desc' }];
    case 'title':
      return [{ title: dir }, { id: dir }];
    case 'createdAt':
    default:
      return [{ createdAt: dir }, { id: dir }];
  }
}
