import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Paginated, toSkipTake } from '../../common/dto/pagination.dto';
import { assertUniqueIds } from '../../common/dto/reorder.dto';
import { resolveWriteTexts, TranslationDraft } from '../../common/i18n/content-locale';
import { syncWallpaperTranslations } from '../../common/i18n/persist-translations';
import { toItemError } from '../../common/utils/bulk.util';
import { lockWallpaperRows } from '../../common/utils/row-lock';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit-logs/audit-actions';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { BulkResult } from '../media/dto/media.dto';
import { MEDIA_URL_SELECT, MediaUrlService } from '../media/media-url.service';
import { MediaService, UploadInput } from '../media/media.service';
import { sanitizeFilename } from '../media/upload-options';
import {
  BulkCreateWallpapersDto,
  BulkUpdateWallpapersDto,
  BulkWallpaperAction,
  CreateWallpaperDto,
  ListWallpapersQueryDto,
  UpdateWallpaperDto,
  UploadWallpapersFormDto,
  WallpaperAdminResponseDto,
} from './dto/wallpaper.dto';
import { orientationOf, wallpaperOrderBy, wallpaperSearchFilter } from './wallpaper-query.util';

export const WALLPAPER_ADMIN_INCLUDE = {
  originalMedia: { select: MEDIA_URL_SELECT },
  translations: { select: { locale: true, title: true, description: true }, orderBy: { locale: 'asc' as const } },
  categories: {
    select: { category: { select: { id: true, name: true, slug: true } } },
    orderBy: { category: { sortOrder: 'asc' } },
  },
} satisfies Prisma.WallpaperInclude;

type WallpaperWithRelations = Prisma.WallpaperGetPayload<{ include: typeof WALLPAPER_ADMIN_INCLUDE }>;
type Tx = Prisma.TransactionClient;

export interface BulkUpdateItemResult {
  id: string;
  status: 'success' | 'error';
  error?: { statusCode: number; message: string };
}

@Injectable()
export class WallpapersService {
  private readonly logger = new Logger(WallpapersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly urls: MediaUrlService,
    private readonly audit: AuditLogsService,
  ) {}

  async create(dto: CreateWallpaperDto, actor: AuthenticatedAdmin, meta?: RequestMeta): Promise<WallpaperAdminResponseDto> {
    const media = await this.media.assertUsable(dto.mediaId);
    if (dto.categoryIds?.length) await this.assertCategoriesExist(dto.categoryIds);
    const write = this.textsForWrite(dto.translations, dto.title, dto.description ?? null, null);
    if (!write?.parent.primary) throw new BadRequestException('Wallpaper title is required');
    this.assertUniqueLocales(dto.translations?.map((row) => row.locale) ?? []);
    const slug = dto.slug ?? (await this.uniqueSlug(write.parent.primary));
    if (dto.slug) await this.assertSlugFree(dto.slug);
    const isPublished = dto.isPublished ?? false;

    const wallpaper = await this.prisma.$transaction(async (tx) => {
      const created = await tx.wallpaper.create({
        data: {
          title: write.parent.primary,
          description: write.parent.secondary,
          slug,
          originalMediaId: media.id,
          width: media.width,
          height: media.height,
          orientation: orientationOf(media.width, media.height),
          tags: dto.tags ?? [],
          isFeatured: dto.isFeatured ?? false,
          isPublished,
          publishedAt: isPublished ? new Date() : null,
          sortOrder: dto.sortOrder ?? 0,
          categories: dto.categoryIds?.length
            ? { createMany: { data: dto.categoryIds.map((categoryId) => ({ categoryId })) } }
            : undefined,
        },
      });
      await syncWallpaperTranslations(tx, created.id, write.rows, write.replace);
      const full = await tx.wallpaper.findUniqueOrThrow({ where: { id: created.id }, include: WALLPAPER_ADMIN_INCLUDE });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.WallpaperCreated,
          entityType: AuditEntity.Wallpaper,
          entityId: full.id,
          metadata: { title: full.title, isPublished, categoryIds: dto.categoryIds ?? [], locales: write.rows.map((row) => row.locale) },
          meta,
        },
        tx,
      );
      return full;
    });
    return this.toResponse(wallpaper);
  }

  /** Creates one wallpaper per item; every item succeeds or fails independently. */
  async bulkCreate(dto: BulkCreateWallpapersDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<BulkResult<WallpaperAdminResponseDto>> {
    if (dto.categoryIds?.length) await this.assertCategoriesExist(dto.categoryIds);
    const results: BulkResult<WallpaperAdminResponseDto>['results'] = [];
    for (const [index, item] of dto.items.entries()) {
      try {
        const title = item.title ?? (await this.defaultTitle(item.mediaId));
        const created = await this.create(
          {
            title,
            description: item.description,
            mediaId: item.mediaId,
            tags: item.tags,
            categoryIds: dto.categoryIds,
            isPublished: dto.isPublished,
            isFeatured: dto.isFeatured,
          },
          actor,
          meta,
        );
        results.push({ index, filename: null, status: 'success', item: created });
      } catch (error) {
        results.push({ index, filename: null, status: 'error', error: toItemError(error) });
      }
    }
    return this.summarize(results, actor, meta);
  }

  /** Uploads images and creates a wallpaper for each; removes the uploaded media if creation fails. */
  async uploadAndCreate(
    files: UploadInput[],
    form: UploadWallpapersFormDto,
    actor: AuthenticatedAdmin,
    meta: RequestMeta,
  ): Promise<BulkResult<WallpaperAdminResponseDto>> {
    if (form.categoryIds?.length) await this.assertCategoriesExist(form.categoryIds);
    const results: BulkResult<WallpaperAdminResponseDto>['results'] = [];
    for (const [index, file] of files.entries()) {
      const filename = sanitizeFilename(file.originalname);
      let mediaId: string | null = null;
      try {
        mediaId = (await this.media.upload(file, actor, meta)).id;
        const created = await this.create(
          {
            title: titleFromFilename(filename),
            mediaId,
            categoryIds: form.categoryIds,
            isPublished: form.isPublished,
            isFeatured: form.isFeatured,
          },
          actor,
          meta,
        );
        results.push({ index, filename, status: 'success', item: created });
      } catch (error) {
        if (mediaId) {
          await this.media.remove(mediaId, actor, meta).catch((e: unknown) => this.logger.warn(`Compensation failed: ${String(e)}`));
        }
        results.push({ index, filename, status: 'error', error: toItemError(error) });
      }
    }
    return this.summarize(results, actor, meta);
  }

  async list(query: ListWallpapersQueryDto, forcedCategoryId?: string): Promise<Paginated<WallpaperAdminResponseDto>> {
    const categoryId = forcedCategoryId ?? query.categoryId;
    const and: Prisma.WallpaperWhereInput[] = [];
    if (query.search) and.push(wallpaperSearchFilter(query.search, true));
    const where: Prisma.WallpaperWhereInput = {
      ...(query.isPublished !== undefined ? { isPublished: query.isPublished } : {}),
      ...(query.isFeatured !== undefined ? { isFeatured: query.isFeatured } : {}),
      ...(query.orientation ? { orientation: query.orientation } : {}),
      ...(categoryId ? { categories: { some: { categoryId } } } : query.uncategorized ? { categories: { none: {} } } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.wallpaper.findMany({
        where,
        include: WALLPAPER_ADMIN_INCLUDE,
        orderBy: wallpaperOrderBy(query.sortBy, query.sortDir),
        ...toSkipTake(query),
      }),
      this.prisma.wallpaper.count({ where }),
    ]);
    return Paginated.of(items.map((w) => this.toResponse(w)), total, query.page, query.limit);
  }

  async get(id: string): Promise<WallpaperAdminResponseDto> {
    const wallpaper = await this.prisma.wallpaper.findUnique({ where: { id }, include: WALLPAPER_ADMIN_INCLUDE });
    if (!wallpaper) throw new NotFoundException('Wallpaper not found');
    return this.toResponse(wallpaper);
  }

  async update(id: string, dto: UpdateWallpaperDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<WallpaperAdminResponseDto> {
    const existing = await this.prisma.wallpaper.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Wallpaper not found');
    const media = dto.mediaId ? await this.media.assertUsable(dto.mediaId) : null;
    if (dto.categoryIds?.length) await this.assertCategoriesExist(dto.categoryIds);
    if (dto.slug && dto.slug !== existing.slug) await this.assertSlugFree(dto.slug, id);
    this.assertUniqueLocales(dto.translations?.map((row) => row.locale) ?? []);
    const write = this.textsForWrite(dto.translations, dto.title, dto.description, {
      primary: existing.title,
      secondary: existing.description,
    });
    if (write && !write.parent.primary) throw new BadRequestException('Wallpaper title is required');

    const publishChange = dto.isPublished !== undefined && dto.isPublished !== existing.isPublished;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.categoryIds) {
        await lockWallpaperRows(tx, [id]);
        await tx.wallpaperCategory.deleteMany({ where: { wallpaperId: id, categoryId: { notIn: dto.categoryIds } } });
        await tx.wallpaperCategory.createMany({
          data: dto.categoryIds.map((categoryId) => ({ wallpaperId: id, categoryId })),
          skipDuplicates: true,
        });
      }
      if (write) await syncWallpaperTranslations(tx, id, write.rows, write.replace);
      const wallpaper = await tx.wallpaper.update({
        where: { id },
        data: {
          ...(write ? { title: write.parent.primary, description: write.parent.secondary } : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
          ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isPublished !== undefined
            ? { isPublished: dto.isPublished, ...(dto.isPublished && !existing.publishedAt ? { publishedAt: new Date() } : {}) }
            : {}),
          ...(media
            ? {
                originalMediaId: media.id,
                width: media.width,
                height: media.height,
                orientation: orientationOf(media.width, media.height),
              }
            : {}),
        },
        include: WALLPAPER_ADMIN_INCLUDE,
      });
      await this.audit.record(
        {
          adminId: actor.id,
          action: publishChange
            ? dto.isPublished
              ? AuditAction.WallpaperPublished
              : AuditAction.WallpaperUnpublished
            : AuditAction.WallpaperUpdated,
          entityType: AuditEntity.Wallpaper,
          entityId: id,
          metadata: { changes: dto },
          meta,
        },
        tx,
      );
      return wallpaper;
    });
    return this.toResponse(updated);
  }

  setPublished(id: string, isPublished: boolean, actor: AuthenticatedAdmin, meta: RequestMeta) {
    return this.update(id, { isPublished }, actor, meta);
  }

  async remove(id: string, deleteMedia: boolean, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<void> {
    const wallpaper = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.wallpaper.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Wallpaper not found');
      await tx.wallpaper.delete({ where: { id } });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.WallpaperDeleted,
          entityType: AuditEntity.Wallpaper,
          entityId: id,
          metadata: { title: existing.title, slug: existing.slug, mediaId: existing.originalMediaId },
          meta,
        },
        tx,
      );
      return existing;
    });
    if (deleteMedia) {
      try {
        await this.media.remove(wallpaper.originalMediaId, actor, meta);
      } catch (error) {
        if (!(error instanceof ConflictException || error instanceof NotFoundException)) throw error;
        // Image is still used elsewhere (or already gone): keep it.
      }
    }
  }

  /**
   * Set-based bulk updates. Unknown ids are reported per item (404); the remaining ids are
   * updated together in one transaction so the batch is consistent.
   */
  async bulkUpdate(dto: BulkUpdateWallpapersDto, actor: AuthenticatedAdmin, meta: RequestMeta) {
    if (dto.action === BulkWallpaperAction.Reorder) return this.bulkReorder(dto, actor, meta);

    const ids = dto.ids ?? [];
    const found = await this.prisma.wallpaper.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const known = new Set(found.map((f) => f.id));
    const targets = ids.filter((id) => known.has(id));
    if (dto.categoryIds?.length) await this.assertCategoriesExist(dto.categoryIds);

    if (targets.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await this.applyBulkAction(tx, dto, targets);
        await this.audit.record(
          {
            adminId: actor.id,
            action:
              dto.action === BulkWallpaperAction.Delete
                ? AuditAction.WallpaperDeleted
                : dto.action === BulkWallpaperAction.Publish
                  ? AuditAction.WallpaperPublished
                  : dto.action === BulkWallpaperAction.Unpublish
                    ? AuditAction.WallpaperUnpublished
                    : AuditAction.WallpaperBulkUpdated,
            entityType: AuditEntity.Wallpaper,
            metadata: { bulk: true, action: dto.action, ids: targets, categoryIds: dto.categoryIds },
            meta,
          },
          tx,
        );
      });
    }

    const results: BulkUpdateItemResult[] = ids.map((id) =>
      known.has(id)
        ? { id, status: 'success' }
        : { id, status: 'error', error: { statusCode: 404, message: 'Wallpaper not found' } },
    );
    return { action: dto.action, succeeded: targets.length, failed: ids.length - targets.length, results };
  }

  private async applyBulkAction(tx: Tx, dto: BulkUpdateWallpapersDto, ids: string[]): Promise<void> {
    const where = { id: { in: ids } };
    switch (dto.action) {
      case BulkWallpaperAction.Publish:
        await tx.wallpaper.updateMany({ where: { ...where, publishedAt: null }, data: { publishedAt: new Date() } });
        await tx.wallpaper.updateMany({ where, data: { isPublished: true } });
        return;
      case BulkWallpaperAction.Unpublish:
        await tx.wallpaper.updateMany({ where, data: { isPublished: false } });
        return;
      case BulkWallpaperAction.Feature:
        await tx.wallpaper.updateMany({ where, data: { isFeatured: true } });
        return;
      case BulkWallpaperAction.Unfeature:
        await tx.wallpaper.updateMany({ where, data: { isFeatured: false } });
        return;
      case BulkWallpaperAction.AddCategories:
        await lockWallpaperRows(tx, ids);
        await tx.wallpaperCategory.createMany({
          data: ids.flatMap((wallpaperId) => dto.categoryIds!.map((categoryId) => ({ wallpaperId, categoryId }))),
          skipDuplicates: true,
        });
        return;
      case BulkWallpaperAction.RemoveCategories:
        await lockWallpaperRows(tx, ids);
        await tx.wallpaperCategory.deleteMany({ where: { wallpaperId: { in: ids }, categoryId: { in: dto.categoryIds! } } });
        return;
      case BulkWallpaperAction.Delete:
        await tx.wallpaper.deleteMany({ where });
        return;
      case BulkWallpaperAction.Reorder:
        return;
    }
  }

  private async bulkReorder(dto: BulkUpdateWallpapersDto, actor: AuthenticatedAdmin, meta: RequestMeta) {
    const items = dto.items ?? [];
    const duplicates = assertUniqueIds(items);
    if (duplicates.length > 0) throw new BadRequestException(`Duplicate ids: ${[...new Set(duplicates)].join(', ')}`);
    const found = await this.prisma.wallpaper.findMany({ where: { id: { in: items.map((i) => i.id) } }, select: { id: true } });
    const known = new Set(found.map((f) => f.id));
    const valid = items.filter((i) => known.has(i.id));
    if (valid.length > 0) {
      await this.prisma.$transaction([
        ...valid.map((i) => this.prisma.wallpaper.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder } })),
      ]);
      await this.audit.record({
        adminId: actor.id,
        action: AuditAction.WallpaperBulkUpdated,
        entityType: AuditEntity.Wallpaper,
        metadata: { bulk: true, action: dto.action, items: valid },
        meta,
      });
    }
    const results: BulkUpdateItemResult[] = items.map((i) =>
      known.has(i.id)
        ? { id: i.id, status: 'success' }
        : { id: i.id, status: 'error', error: { statusCode: 404, message: 'Wallpaper not found' } },
    );
    return { action: dto.action, succeeded: valid.length, failed: items.length - valid.length, results };
  }

  toResponse(w: WallpaperWithRelations): WallpaperAdminResponseDto {
    return {
      id: w.id,
      title: w.title,
      description: w.description,
      translations: w.translations.map((row) => ({ locale: row.locale, title: row.title, description: row.description })),
      slug: w.slug,
      tags: w.tags,
      orientation: w.orientation,
      width: w.width,
      height: w.height,
      isFeatured: w.isFeatured,
      isPublished: w.isPublished,
      sortOrder: w.sortOrder,
      publishedAt: w.publishedAt,
      image: { mediaId: w.originalMedia.id, ...this.urls.urls(w.originalMedia) },
      categories: w.categories.map((c) => c.category),
      stats: { views: w.viewCount, downloadClicks: w.downloadClickCount, downloads: w.downloadCount },
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    };
  }

  private async summarize(
    results: BulkResult<WallpaperAdminResponseDto>['results'],
    actor: AuthenticatedAdmin,
    meta: RequestMeta,
  ): Promise<BulkResult<WallpaperAdminResponseDto>> {
    const succeeded = results.filter((r) => r.status === 'success').length;
    if (succeeded > 0) {
      await this.audit.record({
        adminId: actor.id,
        action: AuditAction.WallpaperBulkCreated,
        entityType: AuditEntity.Wallpaper,
        metadata: { succeeded, failed: results.length - succeeded },
        meta,
      });
    }
    return { succeeded, failed: results.length - succeeded, results };
  }

  private textsForWrite(
    translations: CreateWallpaperDto['translations'],
    legacyPrimary: string | undefined,
    legacySecondary: string | null | undefined,
    previous: { primary: string; secondary: string | null } | null,
  ) {
    const drafts: TranslationDraft[] | undefined = translations?.map((row) => ({
      locale: row.locale,
      primary: row.title,
      secondary: row.description ?? null,
    }));
    return resolveWriteTexts({ translations: drafts, legacyPrimary, legacySecondary, previous });
  }

  private assertUniqueLocales(locales: string[]): void {
    if (new Set(locales).size !== locales.length) throw new BadRequestException('Duplicate translation locales');
  }

  private async assertCategoriesExist(categoryIds: string[]): Promise<void> {
    const found = await this.prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true } });
    if (found.length !== new Set(categoryIds).size) {
      const known = new Set(found.map((f) => f.id));
      throw new NotFoundException({ message: 'Some categories were not found', details: categoryIds.filter((id) => !known.has(id)) });
    }
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.wallpaper.findUnique({ where: { slug }, select: { id: true } });
    if (clash && clash.id !== exceptId) throw new ConflictException(`Slug "${slug}" is already in use`);
  }

  private uniqueSlug(title: string): Promise<string> {
    return generateUniqueSlug(title, async (slug) => (await this.prisma.wallpaper.count({ where: { slug } })) > 0, 180);
  }

  private async defaultTitle(mediaId: string): Promise<string> {
    const media = await this.media.assertUsable(mediaId);
    return titleFromFilename(media.originalFilename);
  }
}

function titleFromFilename(filename: string | null): string {
  if (!filename) return 'Untitled wallpaper';
  const base = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return (base || 'Untitled wallpaper').slice(0, 150);
}
