import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HomeSection, HomeSectionType, Prisma } from '../../generated/prisma/client';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { assertUniqueIds, ReorderDto } from '../../common/dto/reorder.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit-logs/audit-actions';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import {
  CategoriesConfig,
  CategoryWallpapersConfig,
  CONFIG_CLASSES,
  CreateHomeSectionDto,
  CustomWallpapersConfig,
  UpdateHomeSectionDto,
} from './dto/home-section.dto';

@Injectable()
export class HomeSectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  list(): Promise<HomeSection[]> {
    return this.prisma.homeSection.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async get(id: string): Promise<HomeSection> {
    const section = await this.prisma.homeSection.findUnique({ where: { id } });
    if (!section) throw new NotFoundException('Home section not found');
    return section;
  }

  async create(dto: CreateHomeSectionDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<HomeSection> {
    const configuration = await this.validateConfiguration(dto.sectionType, dto.configuration ?? {});
    const sortOrder = dto.sortOrder ?? (await this.nextSortOrder());
    return this.prisma.$transaction(async (tx) => {
      const section = await tx.homeSection.create({
        data: {
          title: dto.title,
          sectionType: dto.sectionType,
          isEnabled: dto.isEnabled ?? true,
          sortOrder,
          configuration: configuration as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.HomeSectionCreated,
          entityType: AuditEntity.HomeSection,
          entityId: section.id,
          metadata: { title: section.title, sectionType: section.sectionType },
          meta,
        },
        tx,
      );
      return section;
    });
  }

  async update(id: string, dto: UpdateHomeSectionDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<HomeSection> {
    const existing = await this.get(id);
    const type = dto.sectionType ?? existing.sectionType;
    const needsValidation = dto.configuration !== undefined || dto.sectionType !== undefined;
    const configuration = needsValidation
      ? await this.validateConfiguration(type, dto.configuration ?? (existing.configuration as Record<string, unknown>))
      : undefined;

    return this.prisma.$transaction(async (tx) => {
      const section = await tx.homeSection.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.sectionType !== undefined ? { sectionType: dto.sectionType } : {}),
          ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(configuration !== undefined ? { configuration: configuration as Prisma.InputJsonValue } : {}),
        },
      });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.HomeSectionUpdated,
          entityType: AuditEntity.HomeSection,
          entityId: id,
          metadata: { changes: dto },
          meta,
        },
        tx,
      );
      return section;
    });
  }

  async reorder(dto: ReorderDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<{ updated: number }> {
    const duplicates = assertUniqueIds(dto.items);
    if (duplicates.length > 0) throw new BadRequestException(`Duplicate ids: ${[...new Set(duplicates)].join(', ')}`);
    const ids = dto.items.map((i) => i.id);
    const found = await this.prisma.homeSection.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new NotFoundException('Some home sections were not found');
    await this.prisma.$transaction(
      dto.items.map((i) => this.prisma.homeSection.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder } })),
    );
    await this.audit.record({
      adminId: actor.id,
      action: AuditAction.HomeSectionReordered,
      entityType: AuditEntity.HomeSection,
      metadata: { items: dto.items },
      meta,
    });
    return { updated: ids.length };
  }

  async remove(id: string, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<void> {
    const existing = await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.homeSection.delete({ where: { id } });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.HomeSectionDeleted,
          entityType: AuditEntity.HomeSection,
          entityId: id,
          metadata: { title: existing.title, sectionType: existing.sectionType },
          meta,
        },
        tx,
      );
    });
  }

  /**
   * Validates configuration against the schema of the section type (unknown keys rejected)
   * and checks that referenced categories/wallpapers exist.
   */
  async validateConfiguration(type: HomeSectionType, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
    const instance = plainToInstance(CONFIG_CLASSES[type] as new () => object, raw);
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: `Invalid configuration for ${type}`,
        details: errors.flatMap((e) => Object.values(e.constraints ?? {}).map((m) => `configuration.${m}`)),
      });
    }

    if (type === 'CATEGORY_WALLPAPERS') {
      const { categoryId } = instance as CategoryWallpapersConfig;
      if (!(await this.prisma.category.count({ where: { id: categoryId } }))) {
        throw new NotFoundException(`Category ${categoryId} not found`);
      }
    }
    if (type === 'CATEGORIES') {
      const ids = (instance as CategoriesConfig).categoryIds;
      if (ids?.length) await this.assertAllExist('category', ids);
    }
    if (type === 'CUSTOM_WALLPAPERS') {
      await this.assertAllExist('wallpaper', (instance as CustomWallpapersConfig).wallpaperIds);
    }
    return JSON.parse(JSON.stringify(instance)) as Record<string, unknown>;
  }

  private async assertAllExist(kind: 'category' | 'wallpaper', ids: string[]): Promise<void> {
    const found =
      kind === 'category'
        ? await this.prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true } })
        : await this.prisma.wallpaper.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) {
      const known = new Set(found.map((f) => f.id));
      throw new NotFoundException({ message: `Some ${kind} ids were not found`, details: ids.filter((i) => !known.has(i)) });
    }
  }

  private async nextSortOrder(): Promise<number> {
    const agg = await this.prisma.homeSection.aggregate({ _max: { sortOrder: true } });
    return (agg._max.sortOrder ?? -1) + 1;
  }
}
