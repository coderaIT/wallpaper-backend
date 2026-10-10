import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Paginated, toSkipTake } from '../../common/dto/pagination.dto';
import { assertUniqueIds, ReorderDto } from '../../common/dto/reorder.dto';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit-logs/audit-actions';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { MEDIA_URL_SELECT, MediaUrlService } from '../media/media-url.service';
import { MediaService } from '../media/media.service';
import {
  CategoryResponseDto,
  CategorySortField,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

export const CATEGORY_ADMIN_INCLUDE = {
  coverMedia: { select: MEDIA_URL_SELECT },
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
    const slug = dto.slug ?? (await this.uniqueSlug(dto.name));
    await this.assertSlugFree(slug);
    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder());

    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description ?? null,
          coverMediaId: dto.coverMediaId ?? null,
          isPublished: dto.isPublished ?? false,
          sortOrder,
        },
        include: CATEGORY_ADMIN_INCLUDE,
      });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.CategoryCreated,
          entityType: AuditEntity.Category,
          entityId: created.id,
          metadata: { name: created.name, slug: created.slug, isPublished: created.isPublished },
          meta,
        },
        tx,
      );
      return created;
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const category = await tx.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
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

  /** Deletes the category and its wallpaper links only; wallpapers themselves are untouched. */
  async remove(id: string, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const category = await tx.category.findUnique({
        where: { id },
        include: { _count: { select: { wallpapers: true } } },
      });
      if (!category) throw new NotFoundException('Category not found');
      await tx.category.delete({ where: { id } });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.CategoryDeleted,
          entityType: AuditEntity.Category,
          entityId: id,
          metadata: { name: category.name, slug: category.slug, unlinkedWallpapers: category._count.wallpapers },
          meta,
        },
        tx,
      );
    });
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

  private async nextSortOrder(): Promise<number> {
    const agg = await this.prisma.category.aggregate({ _max: { sortOrder: true } });
    return (agg._max.sortOrder ?? -1) + 1;
  }
}
