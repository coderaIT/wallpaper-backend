import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsReportsService } from '../analytics/analytics-reports.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MEDIA_URL_SELECT, MediaUrlService } from '../media/media-url.service';
import { MediaService } from '../media/media.service';

const DAY_MS = 86_400_000;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: AnalyticsReportsService,
    private readonly audit: AuditLogsService,
    private readonly media: MediaService,
    private readonly urls: MediaUrlService,
  ) {}

  async overview() {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const daysAgo = (n: number) => new Date(today.getTime() - n * DAY_MS);

    const [wallpapers, published, featured, categories, publishedCategories, banners, activeBanners, originals, todayStats, last7, last30, top] =
      await Promise.all([
        this.prisma.wallpaper.count(),
        this.prisma.wallpaper.count({ where: { isPublished: true } }),
        this.prisma.wallpaper.count({ where: { isPublished: true, isFeatured: true } }),
        this.prisma.category.count(),
        this.prisma.category.count({ where: { isPublished: true } }),
        this.prisma.banner.count(),
        this.prisma.banner.count({
          where: {
            isActive: true,
            AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
          },
        }),
        this.prisma.mediaAsset.count({ where: { variantType: 'ORIGINAL' } }),
        this.reports.totals(today, today),
        this.reports.totals(daysAgo(6), today),
        this.reports.totals(daysAgo(29), today),
        this.reports.popularWallpapers({ from: isoDate(daysAgo(6)), to: isoDate(today), metric: 'downloads', limit: 5 }),
      ]);

    return {
      content: {
        wallpapers: { total: wallpapers, published, unpublished: wallpapers - published, featured },
        categories: { total: categories, published: publishedCategories },
        banners: { total: banners, activeNow: activeBanners },
        mediaOriginals: originals,
      },
      analytics: { today: todayStats, last7Days: last7, last30Days: last30 },
      topWallpapersLast7Days: top.items,
    };
  }

  async recentWallpapers(limit: number) {
    const rows = await this.prisma.wallpaper.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        title: true,
        slug: true,
        isPublished: true,
        isFeatured: true,
        createdAt: true,
        publishedAt: true,
        originalMedia: { select: MEDIA_URL_SELECT },
      },
    });
    return rows.map(({ originalMedia, ...w }) => ({ ...w, thumbnailUrl: this.urls.urls(originalMedia).thumbnailUrl }));
  }

  recentActivity(limit: number) {
    return this.audit.recent(limit);
  }

  async storage() {
    const stats = await this.media.storageStats();
    const variants = Object.fromEntries(
      stats.grouped.map((g) => [g.variantType, { count: g._count._all, bytes: Number(g._sum.size ?? 0) }]),
    ) as Record<string, { count: number; bytes: number }>;
    const totalBytes = Object.values(variants).reduce((acc, v) => acc + v.bytes, 0);
    return {
      provider: stats.provider,
      totalBytes,
      variants: {
        ORIGINAL: variants.ORIGINAL ?? { count: 0, bytes: 0 },
        PREVIEW: variants.PREVIEW ?? { count: 0, bytes: 0 },
        THUMBNAIL: variants.THUMBNAIL ?? { count: 0, bytes: 0 },
      },
      unusedOriginals: stats.unusedOriginals,
    };
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
