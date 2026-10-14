import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Paginated, toSkipTake } from '../../common/dto/pagination.dto';
import { assertUniqueIds, ReorderDto } from '../../common/dto/reorder.dto';
import { resolveWriteTexts, TranslationDraft } from '../../common/i18n/content-locale';
import { syncCategoryTranslations } from '../../common/i18n/persist-translations';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit-logs/audit-actions';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { MEDIA_URL_SELECT, MediaUrlService } from '../media/media-url.service';
import { MediaService } from '../media/media.service';
import { idsStillExclusive, planCategoryDeletion } from './category-deletion';
import {
  CategoryDeletionImpactDto,
  CategoryResponseDto,
  CategorySortField,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

export const CATEGORY_ADMIN_INCLUDE = {
  coverMedia: { select: MEDIA_URL_SELECT },
  translations: { select: { locale: true, name: true, description: true }, orderBy: { locale: 'asc' as const } },
  _count: {
    select: {
      wallpapers: true,
    },
  },
} satisfies Prisma.CategoryInclude;

type CategoryWithRelations = Prisma.CategoryGetPayload<{ include: typeof CATEGORY_ADMIN_INCLUDE }>;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly urls: MediaUrlService,
    private readonly audit: AuditLogsService,
  ) {}

  async create(dto: CreateCategoryDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<CategoryResponseDto> {
    if (dto.coverMediaId) await this.media.assertUsable(dto.coverMediaId);
    const write = this.textsForWrite(dto.translations, dto.name, dto.description ?? null, null);
    if (!write?.parent.primary) throw new BadRequestException('Category name is required');
    this.assertUniqueLocales(dto.translations?.map((row) => row.locale) ?? []);
    const slug = dto.slug ?? (await this.uniqueSlug(write.parent.primary));
    await this.assertSlugFree(slug);
    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder());

    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          name: write.parent.primary,
          slug,
          description: write.parent.secondary,
          coverMediaId: dto.coverMediaId ?? null,
          isPublished: dto.isPublished ?? false,
          sortOrder,
        },
      });
      await syncCategoryTranslations(tx, created.id, write.rows, write.replace);
      const full = await tx.category.findUniqueOrThrow({ where: { id: created.id }, include: CATEGORY_ADMIN_INCLUDE });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.CategoryCreated,
          entityType: AuditEntity.Category,
          entityId: full.id,
          metadata: { name: full.name, slug: full.slug, isPublished: full.isPublished, locales: write.rows.map((row) => row.locale) },
          meta,
        },
        tx,
      );
      return full;
    });
    return this.toResponse(category, 0);
  }

  async list(query: ListCategoriesQueryDto): Promise<Paginated<CategoryResponseDto>> {
    const where: Prisma.CategoryWhereInput = {
      ...(query.isPublished !== undefined ? { isPublished: query.isPublished } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search.toLowerCase() } },
              { description: { contains: query.search, mode: 'insensitive' } },
              {
                translations: {
                  some: {
                    OR: [
                      { name: { contains: query.search, mode: 'insensitive' } },
                      { description: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.CategoryOrderByWithRelationInput[] =
      query.sortBy === CategorySortField.WallpaperCount
        ? [{ wallpapers: { _count: query.sortDir } }, { sortOrder: 'asc' }]
        : [{ [query.sortBy]: query.sortDir }, { id: 'asc' }];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({ where, include: CATEGORY_ADMIN_INCLUDE, orderBy, ...toSkipTake(query) }),
      this.prisma.category.count({ where }),
    ]);
    const published = await this.publishedCounts(items.map((c) => c.id));
    return Paginated.of(
      items.map((c) => this.toResponse(c, published.get(c.id) ?? 0)),
      total,
      query.page,
      query.limit,
    );
  }

  async get(id: string): Promise<CategoryResponseDto> {
    const category = await this.prisma.category.findUnique({ where: { id }, include: CATEGORY_ADMIN_INCLUDE });
    if (!category) throw new NotFoundException('Category not found');
    const published = await this.publishedCounts([id]);
    return this.toResponse(category, published.get(id) ?? 0);
  }

  async update(id: string, dto: UpdateCategoryDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<CategoryResponseDto> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');
    if (dto.slug && dto.slug !== existing.slug) await this.assertSlugFree(dto.slug, id);
    this.assertUniqueLocales(dto.translations?.map((row) => row.locale) ?? []);
    const write = this.textsForWrite(dto.translations, dto.name, dto.description, {
      primary: existing.name,
      secondary: existing.description,
    });
    if (write && !write.parent.primary) throw new BadRequestException('Category name is required');

    const updated = await this.prisma.$transaction(async (tx) => {
      if (write) await syncCategoryTranslations(tx, id, write.rows, write.replace);
      const category = await tx.category.update({
        where: { id },
        data: {
          ...(write ? { name: write.parent.primary, description: write.parent.secondary } : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
        include: CATEGORY_ADMIN_INCLUDE,
      });
      const publishChanged = dto.isPublished !== undefined && dto.isPublished !== existing.isPublished;
      await this.audit.record(
        {
          adminId: actor.id,
          action: publishChanged
            ? dto.isPublished
              ? AuditAction.CategoryPublished
              : AuditAction.CategoryUnpublished
            : AuditAction.CategoryUpdated,
          entityType: AuditEntity.Category,
          entityId: id,
          metadata: { changes: dto },
          meta,
        },
        tx,
      );
      return category;
    });
    const published = await this.publishedCounts([id]);
    return this.toResponse(updated, published.get(id) ?? 0);
  }

  async setCover(id: string, mediaId: string | null, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<CategoryResponseDto> {
    const existing = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Category not found');
    if (mediaId) await this.media.assertUsable(mediaId);
    const category = await this.prisma.category.update({
      where: { id },
      data: { coverMediaId: mediaId },
      include: CATEGORY_ADMIN_INCLUDE,
    });
    await this.audit.record({
      adminId: actor.id,
      action: AuditAction.CategoryUpdated,
      entityType: AuditEntity.Category,
      entityId: id,
      metadata: { coverMediaId: mediaId },
      meta,
    });
    const published = await this.publishedCounts([id]);
    return this.toResponse(category, published.get(id) ?? 0);
  }

  async reorder(dto: ReorderDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<{ updated: number }> {
    const duplicates = assertUniqueIds(dto.items);
    if (duplicates.length > 0) throw new BadRequestException(`Duplicate ids: ${[...new Set(duplicates)].join(', ')}`);
    const ids = dto.items.map((i) => i.id);
    const found = await this.prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) {
      const known = new Set(found.map((f) => f.id));
      throw new NotFoundException({ message: 'Some categories were not found', details: ids.filter((i) => !known.has(i)) });
    }
    await this.prisma.$transaction([
      ...dto.items.map((item) =>
        this.prisma.category.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } }),
      ),
    ]);
    await this.audit.record({
      adminId: actor.id,
      action: AuditAction.CategoryReordered,
      entityType: AuditEntity.Category,
      metadata: { items: dto.items },
      meta,
    });
    return { updated: dto.items.length };
  }

  async deletionImpact(id: string): Promise<CategoryDeletionImpactDto> {
    const category = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!category) throw new NotFoundException('Category not found');
    const plan = await this.deletionPlan(this.prisma, id);
    return {
      categoryId: id,
      associatedWallpapers: plan.associatedWallpapers,
      exclusiveWallpapers: plan.exclusiveWallpapers,
      sharedWallpapers: plan.sharedWallpapers,
      mediaEligibleForCleanup: plan.mediaEligibleForCleanup,
    };
  }

  /**
   * Deletes the category. Exclusive wallpapers are removed only when that option is explicit.
   * Shared wallpapers lose this link and stay. Media cleanup runs after commit and refuses files still in use.
   */
  async remove(id: string, deleteExclusiveWallpapers: boolean, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<void> {
    const deletedMediaIds = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; name: string; slug: string }[]>`
        SELECT id::text AS id, name, slug FROM categories WHERE id = ${id}::uuid FOR UPDATE
      `;
      const category = locked[0];
      if (!category) throw new NotFoundException('Category not found');

      const links = await tx.$queryRaw<{ wallpaper_id: string }[]>`
        SELECT wallpaper_id::text AS wallpaper_id
        FROM wallpaper_categories
        WHERE category_id = ${id}::uuid
        ORDER BY wallpaper_id
      `;
      const wallpaperIds = links.map((row) => row.wallpaper_id);
      if (wallpaperIds.length > 0) {
        await tx.$queryRaw`SELECT id FROM wallpapers WHERE id = ANY(${wallpaperIds}::uuid[]) ORDER BY id FOR UPDATE`;
      }
      const counted = wallpaperIds.length
        ? await tx.$queryRaw<{ id: string; media_id: string; category_count: number }[]>`
            SELECT w.id::text AS id,
                   w.original_media_id::text AS media_id,
                   (SELECT COUNT(*)::int FROM wallpaper_categories wc WHERE wc.wallpaper_id = w.id) AS category_count
            FROM wallpapers w
            WHERE w.id = ANY(${wallpaperIds}::uuid[])
          `
        : [];
      const facts = counted.map((row) => ({
        wallpaperId: row.id,
        mediaId: row.media_id,
        categoryCount: Number(row.category_count),
      }));
      const plan = planCategoryDeletion(facts, await this.mediaFacts(tx, id, facts));
      const exclusiveIds = deleteExclusiveWallpapers
        ? idsStillExclusive(
            facts
              .filter((row) => plan.exclusiveWallpaperIds.includes(row.wallpaperId))
              .map((row) => ({ id: row.wallpaperId, categoryCount: row.categoryCount })),
          )
        : [];
      if (exclusiveIds.length > 0) await tx.wallpaper.deleteMany({ where: { id: { in: exclusiveIds } } });
      await tx.category.delete({ where: { id } });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.CategoryDeleted,
          entityType: AuditEntity.Category,
          entityId: id,
          metadata: {
            name: category.name,
            slug: category.slug,
            deleteExclusiveWallpapers,
            associatedWallpapers: plan.associatedWallpapers,
            exclusiveWallpapers: plan.exclusiveWallpapers,
            sharedWallpapers: plan.sharedWallpapers,
            deletedWallpaperIds: exclusiveIds,
            preservedWallpaperIds: plan.sharedWallpaperIds,
          },
          meta,
        },
        tx,
      );
      return facts.filter((row) => exclusiveIds.includes(row.wallpaperId)).map((row) => row.mediaId);
    });

    for (const mediaId of [...new Set(deletedMediaIds)]) {
      try {
        await this.media.remove(mediaId, actor, meta);
      } catch (error) {
        if (!(error instanceof ConflictException || error instanceof NotFoundException)) throw error;
      }
    }
  }

  async assertExists(id: string): Promise<void> {
    const found = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Category not found');
  }

  toResponse(c: CategoryWithRelations, publishedWallpaperCount: number): CategoryResponseDto {
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      translations: c.translations.map((row) => ({ locale: row.locale, name: row.name, description: row.description })),
      sortOrder: c.sortOrder,
      isPublished: c.isPublished,
      cover: c.coverMedia ? { mediaId: c.coverMedia.id, ...this.urls.urls(c.coverMedia) } : null,
      wallpaperCount: c._count.wallpapers,
      publishedWallpaperCount,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  /** One grouped query for the published-wallpaper count of many categories. */
  private async publishedCounts(categoryIds: string[]): Promise<Map<string, number>> {
    if (categoryIds.length === 0) return new Map();
    const rows = await this.prisma.wallpaperCategory.groupBy({
      by: ['categoryId'],
      where: { categoryId: { in: categoryIds }, wallpaper: { isPublished: true } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.categoryId, r._count._all]));
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.category.findUnique({ where: { slug }, select: { id: true } });
    if (clash && clash.id !== exceptId) throw new ConflictException(`Slug "${slug}" is already in use`);
  }

  private uniqueSlug(name: string): Promise<string> {
    return generateUniqueSlug(
      name,
      async (slug) => (await this.prisma.category.count({ where: { slug } })) > 0,
      120,
    );
  }

  private textsForWrite(
    translations: CreateCategoryDto['translations'],
    legacyPrimary: string | undefined,
    legacySecondary: string | null | undefined,
    previous: { primary: string; secondary: string | null } | null,
  ) {
    const drafts: TranslationDraft[] | undefined = translations?.map((row) => ({
      locale: row.locale,
      primary: row.name,
      secondary: row.description ?? null,
    }));
    return resolveWriteTexts({ translations: drafts, legacyPrimary, legacySecondary, previous });
  }

  private assertUniqueLocales(locales: string[]): void {
    if (new Set(locales).size !== locales.length) throw new BadRequestException('Duplicate translation locales');
  }

  private async deletionPlan(db: Prisma.TransactionClient | PrismaService, categoryId: string) {
    const links = await db.wallpaperCategory.findMany({
      where: { categoryId },
      select: { wallpaperId: true, wallpaper: { select: { originalMediaId: true } } },
    });
    const ids = links.map((link) => link.wallpaperId);
    const counts = ids.length
      ? await db.wallpaperCategory.groupBy({
          by: ['wallpaperId'],
          where: { wallpaperId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const countById = new Map(counts.map((row) => [row.wallpaperId, row._count._all]));
    const facts = links.map((link) => ({
      wallpaperId: link.wallpaperId,
      mediaId: link.wallpaper.originalMediaId,
      categoryCount: countById.get(link.wallpaperId) ?? 1,
    }));
    return planCategoryDeletion(facts, await this.mediaFacts(db, categoryId, facts));
  }

  private async mediaFacts(
    db: Prisma.TransactionClient | PrismaService,
    categoryId: string,
    facts: { wallpaperId: string; mediaId: string; categoryCount: number }[],
  ) {
    const exclusive = facts.filter((row) => row.categoryCount === 1);
    const mediaIds = [...new Set(exclusive.map((row) => row.mediaId))];
    const exclusiveIds = exclusive.map((row) => row.wallpaperId);
    if (mediaIds.length === 0) return [];
    const [wallpapers, covers, banners] = await Promise.all([
      db.wallpaper.groupBy({
        by: ['originalMediaId'],
        where: { originalMediaId: { in: mediaIds }, ...(exclusiveIds.length ? { id: { notIn: exclusiveIds } } : {}) },
        _count: { _all: true },
      }),
      db.category.groupBy({
        by: ['coverMediaId'],
        where: { coverMediaId: { in: mediaIds }, NOT: { id: categoryId } },
        _count: { _all: true },
      }),
      db.banner.groupBy({
        by: ['imageMediaId'],
        where: { imageMediaId: { in: mediaIds } },
        _count: { _all: true },
      }),
    ]);
    const wallpaperCounts = new Map(wallpapers.map((row) => [row.originalMediaId, row._count._all]));
    const coverCounts = new Map(covers.flatMap((row) => (row.coverMediaId ? [[row.coverMediaId, row._count._all] as const] : [])));
    const bannerCounts = new Map(banners.map((row) => [row.imageMediaId, row._count._all]));
    return mediaIds.map((mediaId) => ({
      mediaId,
      otherWallpapers: wallpaperCounts.get(mediaId) ?? 0,
      otherCategoryCovers: coverCounts.get(mediaId) ?? 0,
      banners: bannerCounts.get(mediaId) ?? 0,
    }));
  }

  private async nextSortOrder(): Promise<number> {
    const agg = await this.prisma.category.aggregate({ _max: { sortOrder: true } });
    return (agg._max.sortOrder ?? -1) + 1;
  }
}
