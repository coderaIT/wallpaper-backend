import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MEDIA_URL_SELECT, MediaUrlService } from '../media/media-url.service';
import { AnalyticsMetric, DateRangeQueryDto, PopularQueryDto } from './dto/analytics.dto';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;

export interface DateRange {
  from: string;
  to: string;
  fromDate: Date;
  toDate: Date;
  days: number;
}

export interface MetricTotals {
  views: number;
  downloadClicks: number;
  downloads: number;
}

const METRIC_COLUMN: Record<AnalyticsMetric, Prisma.Sql> = {
  views: Prisma.sql`views`,
  downloadClicks: Prisma.sql`download_clicks`,
  downloads: Prisma.sql`downloads`,
};

/** Read-side analytics. All charts read the pre-aggregated daily table, never raw events. */
@Injectable()
export class AnalyticsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: MediaUrlService,
  ) {}

  resolveRange(query: DateRangeQueryDto): DateRange {
    const toDate = query.to ? parseDate(query.to, 'to') : new Date(Date.UTC(...todayParts()));
    const fromDate = query.from ? parseDate(query.from, 'from') : new Date(toDate.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
    if (fromDate > toDate) throw new BadRequestException('from must not be after to');
    const days = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
    if (days > MAX_RANGE_DAYS) throw new BadRequestException(`Date range must be at most ${MAX_RANGE_DAYS} days`);
    return { from: isoDate(fromDate), to: isoDate(toDate), fromDate, toDate, days };
  }

  async overview(query: DateRangeQueryDto) {
    const range = this.resolveRange(query);
    const previous = {
      fromDate: new Date(range.fromDate.getTime() - range.days * DAY_MS),
      toDate: new Date(range.fromDate.getTime() - DAY_MS),
    };
    const [current, prev, allTime, series] = await Promise.all([
      this.totals(range.fromDate, range.toDate),
      this.totals(previous.fromDate, previous.toDate),
      this.prisma.wallpaper.aggregate({ _sum: { viewCount: true, downloadClickCount: true, downloadCount: true } }),
      this.series(range),
    ]);
    return {
      range: { from: range.from, to: range.to },
      totals: current,
      previousPeriod: { from: isoDate(previous.fromDate), to: isoDate(previous.toDate), ...prev },
      allTime: {
        views: allTime._sum.viewCount ?? 0,
        downloadClicks: allTime._sum.downloadClickCount ?? 0,
        downloads: allTime._sum.downloadCount ?? 0,
      },
      series,
    };
  }

  async downloads(query: DateRangeQueryDto) {
    const range = this.resolveRange(query);
    const [series, byPlatform] = await Promise.all([
      this.series(range),
      // Raw events are only kept for the retention window; older ranges return partial platform data.
      this.prisma.wallpaperEvent.groupBy({
        by: ['platform', 'type'],
        where: {
          type: { in: ['WALLPAPER_DOWNLOAD_CLICK', 'WALLPAPER_DOWNLOAD'] },
          createdAt: { gte: range.fromDate, lt: new Date(range.toDate.getTime() + DAY_MS) },
        },
        _count: { _all: true },
      }),
    ]);
    const totals = series.reduce((acc, d) => ({ downloadClicks: acc.downloadClicks + d.downloadClicks, downloads: acc.downloads + d.downloads }), {
      downloadClicks: 0,
      downloads: 0,
    });
    const platforms = new Map<string, { platform: string; downloadClicks: number; downloads: number }>();
    for (const row of byPlatform) {
      const key = row.platform ?? 'UNKNOWN';
      const entry = platforms.get(key) ?? { platform: key, downloadClicks: 0, downloads: 0 };
      if (row.type === 'WALLPAPER_DOWNLOAD_CLICK') entry.downloadClicks += row._count._all;
      else entry.downloads += row._count._all;
      platforms.set(key, entry);
    }
    return {
      range: { from: range.from, to: range.to },
      totals: { ...totals, conversionRate: rate(totals.downloads, totals.downloadClicks) },
      series: series.map((d) => ({ date: d.date, downloadClicks: d.downloadClicks, downloads: d.downloads, conversionRate: rate(d.downloads, d.downloadClicks) })),
      byPlatform: [...platforms.values()].sort((a, b) => b.downloads - a.downloads),
    };
  }

  async popularWallpapers(query: PopularQueryDto) {
    const range = this.resolveRange(query);
    const rows = await this.prisma.wallpaperDailyStat.groupBy({
      by: ['wallpaperId'],
      where: { date: { gte: range.fromDate, lte: range.toDate } },
      _sum: { views: true, downloadClicks: true, downloads: true },
      orderBy: [{ _sum: { [query.metric]: 'desc' } }, { wallpaperId: 'asc' }],
      take: query.limit,
    });
    const wallpapers = await this.prisma.wallpaper.findMany({
      where: { id: { in: rows.map((r) => r.wallpaperId) } },
      select: { id: true, title: true, slug: true, isPublished: true, originalMedia: { select: MEDIA_URL_SELECT } },
    });
    const byId = new Map(wallpapers.map((w) => [w.id, w]));
    return {
      range: { from: range.from, to: range.to },
      metric: query.metric,
      items: rows
        .filter((r) => byId.has(r.wallpaperId))
        .map((r) => {
          const w = byId.get(r.wallpaperId)!;
          return {
            wallpaper: { id: w.id, title: w.title, slug: w.slug, isPublished: w.isPublished, thumbnailUrl: this.urls.urls(w.originalMedia).thumbnailUrl },
            views: r._sum.views ?? 0,
            downloadClicks: r._sum.downloadClicks ?? 0,
            downloads: r._sum.downloads ?? 0,
          };
        }),
    };
  }

  async popularCategories(query: PopularQueryDto) {
    const range = this.resolveRange(query);
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; slug: string; views: bigint; download_clicks: bigint; downloads: bigint }[]>`
      SELECT c.id::text AS id, c.name, c.slug,
             COALESCE(SUM(s.views), 0) AS views,
             COALESCE(SUM(s.download_clicks), 0) AS download_clicks,
             COALESCE(SUM(s.downloads), 0) AS downloads
      FROM wallpaper_daily_stats s
      JOIN wallpaper_categories wc ON wc.wallpaper_id = s.wallpaper_id
      JOIN categories c ON c.id = wc.category_id
      WHERE s.date BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY c.id, c.name, c.slug
      ORDER BY SUM(s.${METRIC_COLUMN[query.metric]}) DESC, c.id
      LIMIT ${query.limit}`;
    return {
      range: { from: range.from, to: range.to },
      metric: query.metric,
      items: rows.map((r) => ({
        category: { id: r.id, name: r.name, slug: r.slug },
        views: Number(r.views),
        downloadClicks: Number(r.download_clicks),
        downloads: Number(r.downloads),
      })),
    };
  }

  /** Totals over an inclusive date range from the daily aggregate table. */
  async totals(fromDate: Date, toDate: Date): Promise<MetricTotals> {
    const agg = await this.prisma.wallpaperDailyStat.aggregate({
      where: { date: { gte: fromDate, lte: toDate } },
      _sum: { views: true, downloadClicks: true, downloads: true },
    });
    return { views: agg._sum.views ?? 0, downloadClicks: agg._sum.downloadClicks ?? 0, downloads: agg._sum.downloads ?? 0 };
  }

  /** One point per day in range (zero-filled). */
  private async series(range: DateRange): Promise<(MetricTotals & { date: string })[]> {
    const rows = await this.prisma.wallpaperDailyStat.groupBy({
      by: ['date'],
      where: { date: { gte: range.fromDate, lte: range.toDate } },
      _sum: { views: true, downloadClicks: true, downloads: true },
    });
    const byDate = new Map(rows.map((r) => [isoDate(r.date), r._sum]));
    return Array.from({ length: range.days }, (_, i) => {
      const date = isoDate(new Date(range.fromDate.getTime() + i * DAY_MS));
      const sum = byDate.get(date);
      return { date, views: sum?.views ?? 0, downloadClicks: sum?.downloadClicks ?? 0, downloads: sum?.downloads ?? 0 };
    });
  }
}

function todayParts(): [number, number, number] {
  const now = new Date();
  return [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()];
}

function parseDate(value: string, field: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || isoDate(d) !== value) throw new BadRequestException(`${field} is not a valid date`);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}
