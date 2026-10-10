import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { BannerActionType, Prisma } from '../../generated/prisma/client';
import { EnvironmentVariables } from '../../config/env.validation';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Paginated, toSkipTake } from '../../common/dto/pagination.dto';
import { assertUniqueIds, ReorderDto } from '../../common/dto/reorder.dto';
import { checkSafeExternalUrl } from '../../common/validators/safe-url.validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit-logs/audit-actions';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { MEDIA_URL_SELECT, MediaUrlService } from '../media/media-url.service';
import { MediaService } from '../media/media.service';
import { BannerResponseDto, CreateBannerDto, ListBannersQueryDto, UpdateBannerDto } from './dto/banner.dto';

const BANNER_INCLUDE = { imageMedia: { select: MEDIA_URL_SELECT } } satisfies Prisma.BannerInclude;
type BannerWithImage = Prisma.BannerGetPayload<{ include: typeof BANNER_INCLUDE }>;

export interface PublicBannerDto {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  action:
    | { type: 'NONE' }
    | { type: 'OPEN_WALLPAPER'; wallpaperId: string }
    | { type: 'OPEN_CATEGORY'; categoryId: string; categorySlug: string }
    | { type: 'OPEN_URL'; url: string };
}

@Injectable()
export class BannersService {
  private readonly allowedHosts: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly urls: MediaUrlService,
    private readonly audit: AuditLogsService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.allowedHosts = config
      .get('BANNER_URL_ALLOWED_HOSTS', { infer: true })
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  }

  async list(query: ListBannersQueryDto): Promise<Paginated<BannerResponseDto>> {
    const where: Prisma.BannerWhereInput = query.isActive !== undefined ? { isActive: query.isActive } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.banner.findMany({ where, include: BANNER_INCLUDE, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], ...toSkipTake(query) }),
      this.prisma.banner.count({ where }),
    ]);
    return Paginated.of(items.map((b) => this.toResponse(b)), total, query.page, query.limit);
  }

  async get(id: string): Promise<BannerResponseDto> {
    const banner = await this.prisma.banner.findUnique({ where: { id }, include: BANNER_INCLUDE });
    if (!banner) throw new NotFoundException('Banner not found');
    return this.toResponse(banner);
  }

  async create(dto: CreateBannerDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<BannerResponseDto> {
    await this.media.assertUsable(dto.imageMediaId);
    const actionValue = await this.validateAction(dto.actionType, dto.actionValue ?? null);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    assertSchedule(startsAt, endsAt);
    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder());

    const banner = await this.prisma.$transaction(async (tx) => {
      const created = await tx.banner.create({
        data: {
          title: dto.title,
          subtitle: dto.subtitle ?? null,
          imageMediaId: dto.imageMediaId,
          actionType: dto.actionType,
          actionValue,
          isActive: dto.isActive ?? false,
          sortOrder,
          startsAt,
          endsAt,
        },
        include: BANNER_INCLUDE,
      });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.BannerCreated,
          entityType: AuditEntity.Banner,
          entityId: created.id,
          metadata: { title: created.title, actionType: created.actionType, actionValue, isActive: created.isActive },
          meta,
        },
        tx,
      );
      return created;
    });
    return this.toResponse(banner);
  }

  async update(id: string, dto: UpdateBannerDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<BannerResponseDto> {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner not found');
    if (dto.imageMediaId) await this.media.assertUsable(dto.imageMediaId);

    const actionType = dto.actionType ?? existing.actionType;
    const actionChanged = dto.actionType !== undefined || dto.actionValue !== undefined;
    const actionValue = actionChanged
      ? await this.validateAction(actionType, dto.actionValue !== undefined ? dto.actionValue : existing.actionValue)
      : existing.actionValue;
    const startsAt = dto.startsAt !== undefined ? (dto.startsAt ? new Date(dto.startsAt) : null) : existing.startsAt;
    const endsAt = dto.endsAt !== undefined ? (dto.endsAt ? new Date(dto.endsAt) : null) : existing.endsAt;
    assertSchedule(startsAt, endsAt);

    const banner = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.banner.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.subtitle !== undefined ? { subtitle: dto.subtitle } : {}),
          ...(dto.imageMediaId !== undefined ? { imageMediaId: dto.imageMediaId } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          actionType,
          actionValue,
          startsAt,
          endsAt,
        },
        include: BANNER_INCLUDE,
      });
      await this.audit.record(
        { adminId: actor.id, action: AuditAction.BannerUpdated, entityType: AuditEntity.Banner, entityId: id, metadata: { changes: dto }, meta },
        tx,
      );
      return updated;
    });
    return this.toResponse(banner);
  }

  async reorder(dto: ReorderDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<{ updated: number }> {
    const duplicates = assertUniqueIds(dto.items);
    if (duplicates.length > 0) throw new BadRequestException(`Duplicate ids: ${[...new Set(duplicates)].join(', ')}`);
    const found = await this.prisma.banner.count({ where: { id: { in: dto.items.map((i) => i.id) } } });
    if (found !== dto.items.length) throw new NotFoundException('Some banners were not found');
    await this.prisma.$transaction(
      dto.items.map((i) => this.prisma.banner.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder } })),
    );
    await this.audit.record({ adminId: actor.id, action: AuditAction.BannerReordered, entityType: AuditEntity.Banner, metadata: { items: dto.items }, meta });
    return { updated: dto.items.length };
  }

  async remove(id: string, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.banner.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Banner not found');
      await tx.banner.delete({ where: { id } });
      await this.audit.record(
        { adminId: actor.id, action: AuditAction.BannerDeleted, entityType: AuditEntity.Banner, entityId: id, metadata: { title: existing.title }, meta },
        tx,
      );
    });
  }

  /**
   * Active banners inside their schedule whose targets are still publicly visible.
   * Targets are resolved with one query per target type (no N+1).
   */
  async listPublic(limit: number): Promise<PublicBannerDto[]> {
    const now = new Date();
    const banners = await this.prisma.banner.findMany({
      where: {
        isActive: true,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      include: BANNER_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: limit * 2,
    });
    const wallpaperIds = banners.filter((b) => b.actionType === 'OPEN_WALLPAPER' && b.actionValue).map((b) => b.actionValue!);
    const categoryIds = banners.filter((b) => b.actionType === 'OPEN_CATEGORY' && b.actionValue).map((b) => b.actionValue!);
    const [wallpapers, categories] = await Promise.all([
      wallpaperIds.length
        ? this.prisma.wallpaper.findMany({ where: { id: { in: wallpaperIds }, isPublished: true }, select: { id: true } })
        : Promise.resolve([]),
      categoryIds.length
        ? this.prisma.category.findMany({ where: { id: { in: categoryIds }, isPublished: true }, select: { id: true, slug: true } })
        : Promise.resolve([]),
    ]);
    const visibleWallpapers = new Set(wallpapers.map((w) => w.id));
    const categorySlugs = new Map(categories.map((c) => [c.id, c.slug]));

    const out: PublicBannerDto[] = [];
    for (const b of banners) {
      const action = this.publicAction(b, visibleWallpapers, categorySlugs);
      if (!action) continue;
      const { previewUrl, thumbnailUrl } = this.urls.urls(b.imageMedia);
      const preview = b.imageMedia.variants.find((v) => v.variantType === 'PREVIEW') ?? b.imageMedia;
      out.push({
        id: b.id,
        title: b.title,
        subtitle: b.subtitle,
        imageUrl: previewUrl,
        thumbnailUrl,
        width: preview.width,
        height: preview.height,
        action,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  private publicAction(
    b: BannerWithImage,
    visibleWallpapers: Set<string>,
    categorySlugs: Map<string, string>,
  ): PublicBannerDto['action'] | null {
    switch (b.actionType) {
      case 'NONE':
        return { type: 'NONE' };
      case 'OPEN_WALLPAPER':
        return b.actionValue && visibleWallpapers.has(b.actionValue) ? { type: 'OPEN_WALLPAPER', wallpaperId: b.actionValue } : null;
      case 'OPEN_CATEGORY': {
        const slug = b.actionValue ? categorySlugs.get(b.actionValue) : undefined;
        return slug ? { type: 'OPEN_CATEGORY', categoryId: b.actionValue!, categorySlug: slug } : null;
      }
      case 'OPEN_URL':
        // Re-validated on read in case the allowlist was tightened after the banner was saved.
        return b.actionValue && checkSafeExternalUrl(b.actionValue, { allowedHosts: this.allowedHosts }) === null
          ? { type: 'OPEN_URL', url: b.actionValue }
          : null;
    }
  }

  private async validateAction(type: BannerActionType, value: string | null): Promise<string | null> {
    switch (type) {
      case 'NONE':
        if (value) throw new BadRequestException('actionValue must be empty for actionType NONE');
        return null;
      case 'OPEN_WALLPAPER': {
        if (!value || !isUUID(value)) throw new BadRequestException('actionValue must be a wallpaper id');
        const exists = await this.prisma.wallpaper.count({ where: { id: value } });
        if (!exists) throw new NotFoundException('Target wallpaper not found');
        return value;
      }
      case 'OPEN_CATEGORY': {
        if (!value || !isUUID(value)) throw new BadRequestException('actionValue must be a category id');
        const exists = await this.prisma.category.count({ where: { id: value } });
        if (!exists) throw new NotFoundException('Target category not found');
        return value;
      }
      case 'OPEN_URL': {
        const problem = checkSafeExternalUrl(value, { allowedHosts: this.allowedHosts });
        if (problem) throw new BadRequestException(`actionValue ${problem}`);
        return new URL(value!).toString();
      }
    }
  }

  private toResponse(b: BannerWithImage): BannerResponseDto {
    return {
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      actionType: b.actionType,
      actionValue: b.actionValue,
      sortOrder: b.sortOrder,
      isActive: b.isActive,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      image: { mediaId: b.imageMedia.id, ...this.urls.urls(b.imageMedia) },
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }

  private async nextSortOrder(): Promise<number> {
    const agg = await this.prisma.banner.aggregate({ _max: { sortOrder: true } });
    return (agg._max.sortOrder ?? -1) + 1;
  }
}

function assertSchedule(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException('endsAt must be after startsAt');
}
