import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaVariantType, Prisma } from '../../generated/prisma/client';
import { EnvironmentVariables } from '../../config/env.validation';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Paginated, toSkipTake } from '../../common/dto/pagination.dto';
import { toItemError } from '../../common/utils/bulk.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit-logs/audit-actions';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { BulkResult, CleanupReport, ListMediaQueryDto, MediaResponseDto } from './dto/media.dto';
import { ImageProcessorService, ProcessedVariant } from './image-processor.service';
import { MediaUrlService } from './media-url.service';
import { STORAGE_PROVIDER, StorageProvider } from './storage/storage-provider.interface';
import { sanitizeFilename } from './upload-options';

export const MEDIA_PREFIX = 'media/';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** Objects younger than this are never treated as orphans (uploads may still be in flight). */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

const MEDIA_DETAIL_INCLUDE = {
  variants: true,
  _count: { select: { wallpapers: true, categoryCovers: true, banners: true } },
} satisfies Prisma.MediaAssetInclude;

type MediaWithDetail = Prisma.MediaAssetGetPayload<{ include: typeof MEDIA_DETAIL_INCLUDE }>;

export interface UploadInput {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

@Injectable()
export class MediaService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MediaService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: ImageProcessorService,
    private readonly urls: MediaUrlService,
    private readonly audit: AuditLogsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    const minutes = this.config.get('MEDIA_ORPHAN_CLEANUP_INTERVAL_MINUTES', { infer: true });
    if (minutes > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupOrphans(false).catch((e: unknown) =>
          this.logger.error('Scheduled orphan cleanup failed', e instanceof Error ? e.stack : String(e)),
        );
      }, minutes * 60_000);
      this.cleanupTimer.unref();
    }
  }

  onApplicationShutdown(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /**
   * Processes and stores one image (original + preview + thumbnail).
   * Failure handling: if any object upload fails, already-uploaded objects are removed; if the
   * database write fails, all uploaded objects are removed. Anything left behind by a crash
   * is collected by {@link cleanupOrphans}.
   */
  async upload(file: UploadInput, actor: AuthenticatedAdmin, meta?: RequestMeta): Promise<MediaResponseDto> {
    const processed = await this.processor.process(file.buffer, file.mimetype);
    const folder = this.folderFor(randomUUID());
    const variants: ProcessedVariant[] = [processed.original, processed.preview, processed.thumbnail];
    const keys = new Map<MediaVariantType, string>(
      variants.map((v) => [v.variantType, `${folder}/${v.variantType.toLowerCase()}.${v.extension}`]),
    );

    await this.putAll(variants.map((v) => ({ key: keys.get(v.variantType)!, variant: v })));

    const originalFilename = sanitizeFilename(file.originalname);
    let created: MediaWithDetail;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const original = await tx.mediaAsset.create({
          data: this.rowFor(processed.original, keys.get('ORIGINAL')!, actor.id, originalFilename),
        });
        await tx.mediaAsset.createMany({
          data: [processed.preview, processed.thumbnail].map((v) => ({
            ...this.rowFor(v, keys.get(v.variantType)!, actor.id, null),
            parentId: original.id,
          })),
        });
        return tx.mediaAsset.findUniqueOrThrow({ where: { id: original.id }, include: MEDIA_DETAIL_INCLUDE });
      });
    } catch (error) {
      await this.safeDelete([...keys.values()]);
      throw error;
    }

    await this.audit.record({
      adminId: actor.id,
      action: AuditAction.MediaUploaded,
      entityType: AuditEntity.Media,
      entityId: created.id,
      metadata: { filename: originalFilename, size: created.size, width: created.width, height: created.height },
      meta,
    });
    return this.toResponse(created);
  }

  /** Uploads files sequentially (bounded memory/CPU) and reports per-file outcomes. */
  async uploadMany(files: UploadInput[], actor: AuthenticatedAdmin, meta?: RequestMeta): Promise<BulkResult<MediaResponseDto>> {
    const results: BulkResult<MediaResponseDto>['results'] = [];
    for (const [index, file] of files.entries()) {
      const filename = sanitizeFilename(file.originalname);
      try {
        results.push({ index, filename, status: 'success', item: await this.upload(file, actor, meta) });
      } catch (error) {
        results.push({ index, filename, status: 'error', error: toItemError(error) });
      }
    }
    const succeeded = results.filter((r) => r.status === 'success').length;
    return { succeeded, failed: results.length - succeeded, results };
  }

  async list(query: ListMediaQueryDto): Promise<Paginated<MediaResponseDto>> {
    const where: Prisma.MediaAssetWhereInput = {
      variantType: 'ORIGINAL',
      ...(query.mimeType ? { mimeType: query.mimeType } : {}),
      ...(query.search ? { originalFilename: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.unused ? { wallpapers: { none: {} }, categoryCovers: { none: {} }, banners: { none: {} } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mediaAsset.findMany({
        where,
        include: MEDIA_DETAIL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);
    return Paginated.of(
      items.map((m) => this.toResponse(m)),
      total,
      query.page,
      query.limit,
    );
  }

  async get(id: string): Promise<MediaResponseDto> {
    const media = await this.prisma.mediaAsset.findFirst({
      where: { id, variantType: 'ORIGINAL' },
      include: MEDIA_DETAIL_INCLUDE,
    });
    if (!media) throw new NotFoundException('Media not found');
    return this.toResponse(media);
  }

  /** Verifies that an id refers to an existing ORIGINAL media asset (used by other modules). */
  async assertUsable(id: string, tx: Prisma.TransactionClient = this.prisma) {
    const media = await tx.mediaAsset.findFirst({
      where: { id, variantType: 'ORIGINAL' },
      select: { id: true, width: true, height: true, originalFilename: true },
    });
    if (!media) throw new NotFoundException(`Media ${id} not found`);
    return media;
  }

  async remove(id: string, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<void> {
    const keys = await this.prisma.$transaction(async (tx) => {
      const media = await tx.mediaAsset.findFirst({
        where: { id, variantType: 'ORIGINAL' },
        include: MEDIA_DETAIL_INCLUDE,
      });
      if (!media) throw new NotFoundException('Media not found');
      const usage = media._count;
      if (usage.wallpapers + usage.categoryCovers + usage.banners > 0) {
        throw new ConflictException({
          message: 'Media is in use and cannot be deleted',
          details: { wallpapers: usage.wallpapers, categories: usage.categoryCovers, banners: usage.banners },
        });
      }
      // Variants cascade via the parent FK; the FK RESTRICT on wallpapers/categories/banners
      // also protects against a reference created concurrently.
      await tx.mediaAsset.delete({ where: { id } });
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.MediaDeleted,
          entityType: AuditEntity.Media,
          entityId: id,
          metadata: { filename: media.originalFilename },
          meta,
        },
        tx,
      );
      return [media.storageKey, ...media.variants.map((v) => v.storageKey)];
    });
    // Objects are removed after commit; if this fails the orphan sweep removes them later.
    await this.safeDelete(keys);
  }

  /**
   * Deletes stored objects that have no MediaAsset row (left by crashes or failed compensations).
   * Objects newer than one hour are skipped to avoid racing in-flight uploads.
   */
  async cleanupOrphans(dryRun: boolean, actor?: AuthenticatedAdmin, meta?: RequestMeta): Promise<CleanupReport> {
    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    let scanned = 0;
    const orphaned: string[] = [];
    let batch: string[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const known = await this.prisma.mediaAsset.findMany({
        where: { storageKey: { in: batch } },
        select: { storageKey: true },
      });
      const knownSet = new Set(known.map((k) => k.storageKey));
      orphaned.push(...batch.filter((k) => !knownSet.has(k)));
      batch = [];
    };

    for await (const obj of this.storage.list(MEDIA_PREFIX)) {
      scanned++;
      if (obj.lastModified.getTime() > cutoff) continue;
      batch.push(obj.key);
      if (batch.length >= 500) await flush();
    }
    await flush();

    let deleted = 0;
    if (!dryRun && orphaned.length > 0) {
      await this.storage.delete(orphaned);
      deleted = orphaned.length;
      this.logger.log(`Orphan cleanup removed ${deleted} object(s)`);
    }
    if (actor) {
      await this.audit.record({
        adminId: actor.id,
        action: AuditAction.MediaCleanup,
        entityType: AuditEntity.Media,
        metadata: { dryRun, scanned, orphaned: orphaned.length, deleted },
        meta,
      });
    }
    return {
      dryRun,
      scannedObjects: scanned,
      orphanedObjects: orphaned.length,
      deletedObjects: deleted,
      orphanedKeys: orphaned.slice(0, 100),
    };
  }

  async storageStats() {
    const grouped = await this.prisma.mediaAsset.groupBy({
      by: ['variantType'],
      _count: { _all: true },
      _sum: { size: true },
    });
    const unused = await this.prisma.mediaAsset.count({
      where: { variantType: 'ORIGINAL', wallpapers: { none: {} }, categoryCovers: { none: {} }, banners: { none: {} } },
    });
    return { grouped, unusedOriginals: unused, provider: this.storage.name };
  }

  toResponse(media: MediaWithDetail): MediaResponseDto {
    const preview = media.variants.find((v) => v.variantType === 'PREVIEW');
    const thumbnail = media.variants.find((v) => v.variantType === 'THUMBNAIL');
    return {
      id: media.id,
      originalFilename: media.originalFilename,
      original: this.urls.file(media),
      preview: preview ? this.urls.file(preview) : null,
      thumbnail: thumbnail ? this.urls.file(thumbnail) : null,
      usage: {
        wallpapers: media._count.wallpapers,
        categories: media._count.categoryCovers,
        banners: media._count.banners,
      },
      createdAt: media.createdAt,
    };
  }

  private folderFor(id: string): string {
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${MEDIA_PREFIX}${now.getUTCFullYear()}/${month}/${id}`;
  }

  private rowFor(v: ProcessedVariant, storageKey: string, uploadedById: string, originalFilename: string | null) {
    return {
      variantType: v.variantType,
      storageKey,
      mimeType: v.mimeType,
      size: v.size,
      width: v.width,
      height: v.height,
      checksumSha256: v.checksumSha256,
      originalFilename,
      uploadedById,
    };
  }

  private async putAll(items: { key: string; variant: ProcessedVariant }[]): Promise<void> {
    const results = await Promise.allSettled(
      items.map(({ key, variant }) =>
        this.storage.put(key, variant.buffer, { contentType: variant.mimeType, cacheControl: IMMUTABLE_CACHE }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      const uploaded = items.filter((_, i) => results[i].status === 'fulfilled').map((i) => i.key);
      await this.safeDelete(uploaded);
      this.logger.error(
        `Storage upload failed (${failed.length}/${items.length})`,
        (failed[0] as PromiseRejectedResult).reason instanceof Error
          ? ((failed[0] as PromiseRejectedResult).reason as Error).stack
          : undefined,
      );
      throw new BadGatewayException('Failed to store the image. Please retry.');
    }
  }

  private async safeDelete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.storage.delete(keys);
    } catch (error) {
      this.logger.warn(`Could not delete ${keys.length} object(s); orphan cleanup will retry: ${String(error)}`);
    }
  }
}
