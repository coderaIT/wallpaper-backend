import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WallpaperOrientation } from '../../generated/prisma/client';
import { Paginated, PaginationQueryDto, toSkipTake } from '../../common/dto/pagination.dto';
import { ContentLocale, resolveLocalizedText } from '../../common/i18n/content-locale';
import { PrismaService } from '../../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { MEDIA_URL_SELECT, MediaUrlService } from '../media/media-url.service';
import { escapeLike, wallpaperSearchFilter } from '../wallpapers/wallpaper-query.util';
import { RELATED_CATEGORY_WEIGHT, RELATED_ORIENTATION_WEIGHT, RELATED_TAG_WEIGHT } from '../../common/utils/related-rank';
import { createShuffleSeed } from '../../common/utils/seed-order';
import {
  PublicCategoryDto,
  PublicFeedQueryDto,
  PublicWallpaperDetailDto,
  PublicWallpaperSort,
  PublicWallpapersQueryDto,
  PublicWallpaperSummaryDto,
} from './dto/public.dto';

/** Minimal columns for list views: keeps payloads small and avoids loading descriptions/tags. */
export const PUBLIC_WALLPAPER_SELECT = {
  id: true,
  title: true,
  slug: true,
  width: true,
  height: true,
  orientation: true,
  isFeatured: true,
  originalMedia: { select: MEDIA_URL_SELECT },
  translations: { select: { locale: true, title: true, description: true } },
} satisfies Prisma.WallpaperSelect;

const PUBLIC_WALLPAPER_DETAIL_SELECT = {
  ...PUBLIC_WALLPAPER_SELECT,
  description: true,
  tags: true,
  publishedAt: true,
  categories: {
    where: { category: { isPublished: true } },
    select: { category: { select: { id: true, name: true, slug: true, translations: { select: { locale: true, name: true, description: true } } } } },
  },
} satisfies Prisma.WallpaperSelect;

const PUBLIC_CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  coverMedia: { select: MEDIA_URL_SELECT },
  translations: { select: { locale: true, name: true, description: true } },
} satisfies Prisma.CategorySelect;

type PublicWallpaperRow = Prisma.WallpaperGetPayload<{ select: typeof PUBLIC_WALLPAPER_SELECT }>;
type PublicCategoryRow = Prisma.CategoryGetPayload<{ select: typeof PUBLIC_CATEGORY_SELECT }>;

export const PUBLISHED: Prisma.WallpaperWhereInput = { isPublished: true };

export function publicOrderBy(sort: PublicWallpaperSort): Prisma.WallpaperOrderByWithRelationInput[] {
  switch (sort) {
    case PublicWallpaperSort.Popular:
      return [{ downloadCount: 'desc' }, { viewCount: 'desc' }, { id: 'desc' }];
    case PublicWallpaperSort.Downloads:
      return [{ downloadCount: 'desc' }, { id: 'desc' }];
    case PublicWallpaperSort.Featured:
      return [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
    case PublicWallpaperSort.Manual:
      return [{ sortOrder: 'asc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
    case PublicWallpaperSort.Latest:
    default:
      return [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
  }
}

/**
 * Read-only catalog for the mobile app. Every query is constrained to published content,
 * and responses are mapped to allowlisted fields only.
 */
@Injectable()
export class PublicCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: MediaUrlService,
    private readonly settings: AppSettingsService,
  ) {}

  async listWallpapers(query: PublicWallpapersQueryDto, locale: ContentLocale): Promise<Paginated<PublicWallpaperSummaryDto>> {
    const categoryId = await this.resolveCategoryId(query.categoryId, query.categorySlug);
    const where: Prisma.WallpaperWhereInput = {
      ...PUBLISHED,
      ...(query.orientation ? { orientation: query.orientation } : {}),
      ...(categoryId ? { categories: { some: { categoryId } } } : {}),
      ...(query.q ? { AND: [wallpaperSearchFilter(query.q, false)] } : {}),
    };
    if (query.sort === PublicWallpaperSort.Random) {
      const seed = query.seed ?? createShuffleSeed();
      return this.pageRandom({ categoryId, orientation: query.orientation, q: query.q }, seed, query, locale);
    }
    return this.page(where, publicOrderBy(query.sort), query, locale);
  }

  featured(query: PublicFeedQueryDto, locale: ContentLocale) {
    return this.page(
      { ...PUBLISHED, isFeatured: true, ...(query.orientation ? { orientation: query.orientation } : {}) },
      publicOrderBy(PublicWallpaperSort.Manual),
      query,
      locale,
    );
  }

  latest(query: PublicFeedQueryDto, locale: ContentLocale) {
    return this.page(
      { ...PUBLISHED, ...(query.orientation ? { orientation: query.orientation } : {}) },
      publicOrderBy(PublicWallpaperSort.Latest),
      query,
      locale,
    );
  }

  popular(query: PublicFeedQueryDto, locale: ContentLocale) {
    return this.page(
      { ...PUBLISHED, ...(query.orientation ? { orientation: query.orientation } : {}) },
      publicOrderBy(PublicWallpaperSort.Popular),
      query,
      locale,
    );
  }

  async getWallpaper(id: string, locale: ContentLocale): Promise<PublicWallpaperDetailDto> {
    const w = await this.prisma.wallpaper.findFirst({ where: { id, ...PUBLISHED }, select: PUBLIC_WALLPAPER_DETAIL_SELECT });
    if (!w) throw new NotFoundException('Wallpaper not found');
    const { downloads } = await this.settings.getSettings();
    const summary = this.toSummary(w, locale);
    const text = resolveLocalizedText(
      w.translations.map((row) => ({ locale: row.locale, primary: row.title, secondary: row.description })),
      locale,
      { primary: w.title, secondary: w.description },
    );
    return {
      ...summary,
      description: text.secondary,
      tags: w.tags,
      categories: w.categories.map((c) => this.categoryRef(c.category, locale)),
      downloadUrl:
        downloads.enabled && downloads.allowOriginalDownload
          ? this.urls.urls(w.originalMedia).originalUrl
          : downloads.enabled
            ? summary.previewUrl
            : null,
      publishedAt: w.publishedAt,
    };
  }

  async related(id: string, query: PaginationQueryDto, locale: ContentLocale): Promise<Paginated<PublicWallpaperSummaryDto>> {
    const source = await this.prisma.wallpaper.findFirst({
      where: { id, ...PUBLISHED },
      select: { id: true, orientation: true },
    });
    if (!source) throw new NotFoundException('Wallpaper not found');
    const skip = (query.page - 1) * query.limit;
    const idRows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT w.id::text AS id
      FROM wallpapers w
      WHERE w.is_published = true AND w.id <> ${id}::uuid
      ORDER BY (
        CASE WHEN EXISTS (
          SELECT 1 FROM wallpaper_categories wc
          WHERE wc.wallpaper_id = w.id
            AND wc.category_id IN (SELECT category_id FROM wallpaper_categories WHERE wallpaper_id = ${id}::uuid)
        ) THEN ${RELATED_CATEGORY_WEIGHT} ELSE 0 END
        + COALESCE((
            SELECT COUNT(*)::int FROM (
              SELECT unnest(w.tags)
              INTERSECT
              SELECT unnest(src.tags) FROM wallpapers src WHERE src.id = ${id}::uuid
            ) shared_tags
          ), 0) * ${RELATED_TAG_WEIGHT}
        + CASE WHEN w.orientation::text = ${source.orientation} THEN ${RELATED_ORIENTATION_WEIGHT} ELSE 0 END
      ) DESC, w.id
      OFFSET ${skip}
      LIMIT ${query.limit}
    `;
    const countRows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM wallpapers w WHERE w.is_published = true AND w.id <> ${id}::uuid
    `;
    return this.orderedSummaries(idRows.map((row) => row.id), Number(countRows[0]?.count ?? 0), query, locale);
  }

  async listCategories(query: PaginationQueryDto, locale: ContentLocale): Promise<Paginated<PublicCategoryDto>> {
    const where: Prisma.CategoryWhereInput = { isPublished: true };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        select: PUBLIC_CATEGORY_SELECT,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.category.count({ where }),
    ]);
    const counts = await this.publishedCounts(rows.map((r) => r.id));
    return Paginated.of(
      rows.map((r) => this.toCategory(r, counts.get(r.id) ?? 0, locale)),
      total,
      query.page,
      query.limit,
    );
  }

  async getCategoryBySlug(slug: string, locale: ContentLocale): Promise<PublicCategoryDto> {
    const row = await this.prisma.category.findFirst({ where: { slug, isPublished: true }, select: PUBLIC_CATEGORY_SELECT });
    if (!row) throw new NotFoundException('Category not found');
    const counts = await this.publishedCounts([row.id]);
    return this.toCategory(row, counts.get(row.id) ?? 0, locale);
  }

  /** Loads published wallpapers by id, preserving the given order (used by home sections). */
  async wallpapersByIds(ids: string[], locale: ContentLocale): Promise<Map<string, PublicWallpaperSummaryDto>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.wallpaper.findMany({ where: { id: { in: ids }, ...PUBLISHED }, select: PUBLIC_WALLPAPER_SELECT });
    return new Map(rows.map((r) => [r.id, this.toSummary(r, locale)]));
  }

  async categoriesByIds(ids: string[] | null, limit: number, locale: ContentLocale): Promise<PublicCategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      where: { isPublished: true, ...(ids ? { id: { in: ids } } : {}) },
      select: PUBLIC_CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: ids ? undefined : limit,
    });
    const counts = await this.publishedCounts(rows.map((r) => r.id));
    const mapped = rows.map((r) => this.toCategory(r, counts.get(r.id) ?? 0, locale));
    if (!ids) return mapped;
    const byId = new Map(mapped.map((c) => [c.id, c]));
    return ids.map((id) => byId.get(id)).filter((c): c is PublicCategoryDto => c !== undefined).slice(0, limit);
  }

  async feed(where: Prisma.WallpaperWhereInput, orderBy: Prisma.WallpaperOrderByWithRelationInput[], take: number, locale: ContentLocale) {
    const rows = await this.prisma.wallpaper.findMany({ where: { ...where, ...PUBLISHED }, select: PUBLIC_WALLPAPER_SELECT, orderBy, take });
    return rows.map((r) => this.toSummary(r, locale));
  }

  toSummary(w: PublicWallpaperRow, locale: ContentLocale): PublicWallpaperSummaryDto {
    const { thumbnailUrl, previewUrl } = this.urls.urls(w.originalMedia);
    const text = resolveLocalizedText(
      w.translations.map((row) => ({ locale: row.locale, primary: row.title, secondary: row.description })),
      locale,
      { primary: w.title, secondary: null },
    );
    return {
      id: w.id,
      title: text.primary,
      slug: w.slug,
      thumbnailUrl,
      previewUrl,
      width: w.width,
      height: w.height,
      orientation: w.orientation,
      isFeatured: w.isFeatured,
    };
  }

  private categoryRef(
    category: { id: string; name: string; slug: string; translations: { locale: string; name: string; description: string | null }[] },
    locale: ContentLocale,
  ) {
    const text = resolveLocalizedText(
      category.translations.map((row) => ({ locale: row.locale, primary: row.name, secondary: row.description })),
      locale,
      { primary: category.name, secondary: null },
    );
    return { id: category.id, name: text.primary, slug: category.slug };
  }

  private toCategory(c: PublicCategoryRow, wallpaperCount: number, locale: ContentLocale): PublicCategoryDto {
    const cover = c.coverMedia ? this.urls.urls(c.coverMedia) : null;
    const text = resolveLocalizedText(
      c.translations.map((row) => ({ locale: row.locale, primary: row.name, secondary: row.description })),
      locale,
      { primary: c.name, secondary: c.description },
    );
    return {
      id: c.id,
      name: text.primary,
      slug: c.slug,
      description: text.secondary,
      thumbnailUrl: cover?.thumbnailUrl ?? null,
      previewUrl: cover?.previewUrl ?? null,
      wallpaperCount,
    };
  }

  private async page(
    where: Prisma.WallpaperWhereInput,
    orderBy: Prisma.WallpaperOrderByWithRelationInput[],
    query: PaginationQueryDto,
    locale: ContentLocale,
  ): Promise<Paginated<PublicWallpaperSummaryDto>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.wallpaper.findMany({ where, select: PUBLIC_WALLPAPER_SELECT, orderBy, ...toSkipTake(query) }),
      this.prisma.wallpaper.count({ where }),
    ]);
    return Paginated.of(
      rows.map((r) => this.toSummary(r, locale)),
      total,
      query.page,
      query.limit,
    );
  }

  private async pageRandom(
    filters: { categoryId?: string; orientation?: WallpaperOrientation; q?: string },
    seed: string,
    query: PaginationQueryDto,
    locale: ContentLocale,
  ): Promise<Paginated<PublicWallpaperSummaryDto>> {
    const conditions: Prisma.Sql[] = [Prisma.sql`w.is_published = true`];
    if (filters.orientation) conditions.push(Prisma.sql`w.orientation::text = ${filters.orientation}`);
    if (filters.categoryId) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM wallpaper_categories wc
        WHERE wc.wallpaper_id = w.id AND wc.category_id = ${filters.categoryId}::uuid
      )`);
    }
    if (filters.q) {
      const pattern = `%${escapeLike(filters.q.trim())}%`;
      const tag = filters.q.trim().toLowerCase();
      conditions.push(Prisma.sql`(
        w.title ILIKE ${pattern}
        OR ${tag} = ANY(w.tags)
        OR COALESCE(w.description, '') ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM wallpaper_translations t
          WHERE t.wallpaper_id = w.id
            AND (t.title ILIKE ${pattern} OR COALESCE(t.description, '') ILIKE ${pattern})
        )
      )`);
    }
    const whereSql = Prisma.join(conditions, ' AND ');
    const skip = (query.page - 1) * query.limit;
    const idRows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT w.id::text AS id
      FROM wallpapers w
      WHERE ${whereSql}
      ORDER BY md5(w.id::text || ':' || ${seed}), w.id
      OFFSET ${skip}
      LIMIT ${query.limit}
    `;
    const countRows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM wallpapers w WHERE ${whereSql}
    `;
    return this.orderedSummaries(
      idRows.map((row) => row.id),
      Number(countRows[0]?.count ?? 0),
      query,
      locale,
      seed,
    );
  }

  private async orderedSummaries(ids: string[], total: number, query: PaginationQueryDto, locale: ContentLocale, seed?: string) {
    if (ids.length === 0) return Paginated.of([], total, query.page, query.limit, seed ? { seed } : undefined);
    const rows = await this.prisma.wallpaper.findMany({ where: { id: { in: ids } }, select: PUBLIC_WALLPAPER_SELECT });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids.map((id) => byId.get(id)).filter((row): row is PublicWallpaperRow => row !== undefined);
    return Paginated.of(
      ordered.map((row) => this.toSummary(row, locale)),
      total,
      query.page,
      query.limit,
      seed ? { seed } : undefined,
    );
  }

  /** Category filters only match published categories; unknown/unpublished -> 404. */
  private async resolveCategoryId(categoryId?: string, categorySlug?: string): Promise<string | undefined> {
    if (!categoryId && !categorySlug) return undefined;
    const found = await this.prisma.category.findFirst({
      where: { isPublished: true, ...(categoryId ? { id: categoryId } : { slug: categorySlug }) },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Category not found');
    return found.id;
  }

  private async publishedCounts(categoryIds: string[]): Promise<Map<string, number>> {
    if (categoryIds.length === 0) return new Map();
    const rows = await this.prisma.wallpaperCategory.groupBy({
      by: ['categoryId'],
      where: { categoryId: { in: categoryIds }, wallpaper: PUBLISHED },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.categoryId, r._count._all]));
  }
}
