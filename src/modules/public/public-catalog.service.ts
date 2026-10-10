import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Paginated, PaginationQueryDto, toSkipTake } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { MEDIA_URL_SELECT, MediaUrlService } from '../media/media-url.service';
import { wallpaperSearchFilter } from '../wallpapers/wallpaper-query.util';
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
} satisfies Prisma.WallpaperSelect;

const PUBLIC_WALLPAPER_DETAIL_SELECT = {
  ...PUBLIC_WALLPAPER_SELECT,
  description: true,
  tags: true,
  publishedAt: true,
  categories: {
    where: { category: { isPublished: true } },
    select: { category: { select: { id: true, name: true, slug: true } } },
  },
} satisfies Prisma.WallpaperSelect;

const PUBLIC_CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  coverMedia: { select: MEDIA_URL_SELECT },
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

  async listWallpapers(query: PublicWallpapersQueryDto): Promise<Paginated<PublicWallpaperSummaryDto>> {
    const categoryId = await this.resolveCategoryId(query.categoryId, query.categorySlug);
    const where: Prisma.WallpaperWhereInput = {
      ...PUBLISHED,
      ...(query.orientation ? { orientation: query.orientation } : {}),
      ...(categoryId ? { categories: { some: { categoryId } } } : {}),
      ...(query.q ? { AND: [wallpaperSearchFilter(query.q, false)] } : {}),
    };
    return this.page(where, publicOrderBy(query.sort), query);
  }

  featured(query: PublicFeedQueryDto) {
    return this.page(
      { ...PUBLISHED, isFeatured: true, ...(query.orientation ? { orientation: query.orientation } : {}) },
      publicOrderBy(PublicWallpaperSort.Manual),
      query,
    );
  }

  latest(query: PublicFeedQueryDto) {
    return this.page(
      { ...PUBLISHED, ...(query.orientation ? { orientation: query.orientation } : {}) },
      publicOrderBy(PublicWallpaperSort.Latest),
      query,
    );
  }

  popular(query: PublicFeedQueryDto) {
    return this.page(
      { ...PUBLISHED, ...(query.orientation ? { orientation: query.orientation } : {}) },
      publicOrderBy(PublicWallpaperSort.Popular),
      query,
    );
  }

  async getWallpaper(id: string): Promise<PublicWallpaperDetailDto> {
    const w = await this.prisma.wallpaper.findFirst({ where: { id, ...PUBLISHED }, select: PUBLIC_WALLPAPER_DETAIL_SELECT });
    if (!w) throw new NotFoundException('Wallpaper not found');
    const { downloads } = await this.settings.getSettings();
    const summary = this.toSummary(w);
    return {
      ...summary,
      description: w.description,
      tags: w.tags,
      categories: w.categories.map((c) => c.category),
      downloadUrl:
        downloads.enabled && downloads.allowOriginalDownload
          ? this.urls.urls(w.originalMedia).originalUrl
          : downloads.enabled
            ? summary.previewUrl
            : null,
      publishedAt: w.publishedAt,
    };
  }

  async listCategories(query: PaginationQueryDto): Promise<Paginated<PublicCategoryDto>> {
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
      rows.map((r) => this.toCategory(r, counts.get(r.id) ?? 0)),
      total,
      query.page,
      query.limit,
    );
  }

  async getCategoryBySlug(slug: string): Promise<PublicCategoryDto> {
    const row = await this.prisma.category.findFirst({ where: { slug, isPublished: true }, select: PUBLIC_CATEGORY_SELECT });
    if (!row) throw new NotFoundException('Category not found');
    const counts = await this.publishedCounts([row.id]);
    return this.toCategory(row, counts.get(row.id) ?? 0);
  }

  /** Loads published wallpapers by id, preserving the given order (used by home sections). */
  async wallpapersByIds(ids: string[]): Promise<Map<string, PublicWallpaperSummaryDto>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.wallpaper.findMany({ where: { id: { in: ids }, ...PUBLISHED }, select: PUBLIC_WALLPAPER_SELECT });
    return new Map(rows.map((r) => [r.id, this.toSummary(r)]));
  }

  async categoriesByIds(ids: string[] | null, limit: number): Promise<PublicCategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      where: { isPublished: true, ...(ids ? { id: { in: ids } } : {}) },
      select: PUBLIC_CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: ids ? undefined : limit,
    });
    const counts = await this.publishedCounts(rows.map((r) => r.id));
    const mapped = rows.map((r) => this.toCategory(r, counts.get(r.id) ?? 0));
    if (!ids) return mapped;
    const byId = new Map(mapped.map((c) => [c.id, c]));
    return ids.map((id) => byId.get(id)).filter((c): c is PublicCategoryDto => c !== undefined).slice(0, limit);
  }

  async feed(where: Prisma.WallpaperWhereInput, orderBy: Prisma.WallpaperOrderByWithRelationInput[], take: number) {
    const rows = await this.prisma.wallpaper.findMany({ where: { ...where, ...PUBLISHED }, select: PUBLIC_WALLPAPER_SELECT, orderBy, take });
    return rows.map((r) => this.toSummary(r));
  }

  toSummary(w: PublicWallpaperRow): PublicWallpaperSummaryDto {
    const { thumbnailUrl, previewUrl } = this.urls.urls(w.originalMedia);
    return {
      id: w.id,
      title: w.title,
      slug: w.slug,
      thumbnailUrl,
      previewUrl,
      width: w.width,
      height: w.height,
      orientation: w.orientation,
      isFeatured: w.isFeatured,
    };
  }

  private toCategory(c: PublicCategoryRow, wallpaperCount: number): PublicCategoryDto {
    const cover = c.coverMedia ? this.urls.urls(c.coverMedia) : null;
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      thumbnailUrl: cover?.thumbnailUrl ?? null,
      previewUrl: cover?.previewUrl ?? null,
      wallpaperCount,
    };
  }

  private async page(
    where: Prisma.WallpaperWhereInput,
    orderBy: Prisma.WallpaperOrderByWithRelationInput[],
    query: PaginationQueryDto,
  ): Promise<Paginated<PublicWallpaperSummaryDto>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.wallpaper.findMany({ where, select: PUBLIC_WALLPAPER_SELECT, orderBy, ...toSkipTake(query) }),
      this.prisma.wallpaper.count({ where }),
    ]);
    return Paginated.of(
      rows.map((r) => this.toSummary(r)),
      total,
      query.page,
      query.limit,
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
