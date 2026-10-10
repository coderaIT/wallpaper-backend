import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { ClientPlatform, Prisma, WallpaperEventType } from '../../generated/prisma/client';
import { EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackEventsDto, TrackEventsResultDto } from './dto/analytics.dto';

interface BufferedEvent {
  wallpaperId: string;
  type: WallpaperEventType;
  platform: ClientPlatform | null;
  appVersion: string | null;
  createdAt: Date;
}

/** Repeats of the same (client, wallpaper, type) inside these windows are counted once. */
const DEDUPE_WINDOW_MS: Record<WallpaperEventType, number> = {
  WALLPAPER_VIEW: 30 * 60_000,
  WALLPAPER_DOWNLOAD_CLICK: 5 * 60_000,
  WALLPAPER_DOWNLOAD: 5 * 60_000,
};
const MAX_DEDUPE_ENTRIES = 200_000;
const MAX_BUFFERED_EVENTS = 50_000;
const FLUSH_THRESHOLD = 5_000;
const MAX_FLUSH_ATTEMPTS = 3;
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60_000;
const RETENTION_DELETE_BATCH = 10_000;

/**
 * Anonymous event ingestion for the mobile app.
 *
 * - Only published wallpapers are accepted; the server assigns timestamps.
 * - Deduplication uses a salted, per-process hash of (IP, wallpaper, type); the IP itself is
 *   never stored or logged, and the random salt makes the hashes unlinkable across restarts.
 * - Events are buffered in memory and written in batches (raw rows, daily aggregates and
 *   wallpaper counters in one transaction), so traffic spikes do not turn into per-event writes.
 *
 * Trade-offs (documented): dedupe state and the buffer are per instance; a crash can lose at
 * most one flush interval of events. Analytics are approximate by design; bots that rotate
 * IPs can still inflate counts, which is bounded by the `events` rate limit.
 */
@Injectable()
export class AnalyticsIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsIngestService.name);
  private readonly salt = randomBytes(32);
  private readonly dedupe = new Map<string, number>();
  private buffer: BufferedEvent[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private failedAttempts = 0;
  private droppedSinceLastFlush = 0;
  private flushTimer?: NodeJS.Timeout;
  private retentionTimer?: NodeJS.Timeout;
  private readonly flushIntervalMs: number;
  private readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.flushIntervalMs = config.get('ANALYTICS_FLUSH_INTERVAL_MS', { infer: true });
    this.retentionDays = config.get('ANALYTICS_RAW_EVENT_RETENTION_DAYS', { infer: true });
  }

  onModuleInit(): void {
    this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.flushTimer.unref();
    this.retentionTimer = setInterval(() => void this.pruneRawEvents().catch((e) => this.logger.error('Retention sweep failed', e)), RETENTION_SWEEP_INTERVAL_MS);
    this.retentionTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.flushTimer);
    clearInterval(this.retentionTimer);
    await this.flush();
  }

  get pendingCount(): number {
    return this.buffer.length;
  }

  async track(dto: TrackEventsDto, clientIp: string | undefined): Promise<TrackEventsResultDto> {
    const ids = [...new Set(dto.events.map((e) => e.wallpaperId))];
    const published = await this.prisma.wallpaper.findMany({ where: { id: { in: ids }, isPublished: true }, select: { id: true } });
    const visible = new Set(published.map((w) => w.id));

    const now = Date.now();
    this.sweepDedupe(now);
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    for (const e of dto.events) {
      if (!visible.has(e.wallpaperId)) {
        rejected++;
        continue;
      }
      const key = this.dedupeKey(clientIp ?? 'unknown', e.wallpaperId, e.type);
      const until = this.dedupe.get(key);
      if (until !== undefined && until > now) {
        duplicates++;
        continue;
      }
      if (this.dedupe.size < MAX_DEDUPE_ENTRIES) this.dedupe.set(key, now + DEDUPE_WINDOW_MS[e.type]);
      this.enqueue({ wallpaperId: e.wallpaperId, type: e.type, platform: e.platform ?? null, appVersion: e.appVersion ?? null, createdAt: new Date(now) });
      accepted++;
    }
    if (this.buffer.length >= FLUSH_THRESHOLD) void this.flush();
    return { accepted, duplicates, rejected };
  }

  /** Writes buffered events. Calls are serialized; safe to invoke concurrently. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.flushOnce());
    return this.flushing;
  }

  /** Deletes raw events past retention in small batches (aggregates are kept). */
  async pruneRawEvents(): Promise<number> {
    const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000);
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM wallpaper_events
        WHERE id IN (SELECT id FROM wallpaper_events WHERE created_at < ${cutoff} LIMIT ${RETENTION_DELETE_BATCH})`;
      total += deleted;
      if (deleted < RETENTION_DELETE_BATCH) break;
    }
    if (total > 0) this.logger.log(`Pruned ${total} raw analytics events older than ${this.retentionDays} days`);
    return total;
  }

  private async flushOnce(): Promise<void> {
    if (this.droppedSinceLastFlush > 0) {
      this.logger.warn(`Analytics buffer was full; dropped ${this.droppedSinceLastFlush} oldest events`);
      this.droppedSinceLastFlush = 0;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.write(batch);
      this.failedAttempts = 0;
    } catch (error) {
      this.failedAttempts++;
      if (this.failedAttempts >= MAX_FLUSH_ATTEMPTS) {
        this.logger.error(`Dropping ${batch.length} analytics events after ${this.failedAttempts} failed flushes`, error as Error);
        this.failedAttempts = 0;
        return;
      }
      this.logger.warn(`Analytics flush failed (attempt ${this.failedAttempts}); will retry: ${(error as Error).message}`);
      this.buffer = [...batch, ...this.buffer].slice(-MAX_BUFFERED_EVENTS);
    }
  }

  private async write(batch: BufferedEvent[]): Promise<void> {
    const daily = new Map<string, { wallpaperId: string; date: string; views: number; clicks: number; downloads: number }>();
    for (const e of batch) {
      const date = e.createdAt.toISOString().slice(0, 10);
      const key = `${e.wallpaperId}|${date}`;
      const row = daily.get(key) ?? { wallpaperId: e.wallpaperId, date, views: 0, clicks: 0, downloads: 0 };
      if (e.type === 'WALLPAPER_VIEW') row.views++;
      else if (e.type === 'WALLPAPER_DOWNLOAD_CLICK') row.clicks++;
      else row.downloads++;
      daily.set(key, row);
    }
    const totals = new Map<string, { views: number; clicks: number; downloads: number }>();
    for (const r of daily.values()) {
      const t = totals.get(r.wallpaperId) ?? { views: 0, clicks: 0, downloads: 0 };
      t.views += r.views;
      t.clicks += r.clicks;
      t.downloads += r.downloads;
      totals.set(r.wallpaperId, t);
    }
    const dailyRows = [...daily.values()];
    const totalRows = [...totals.entries()];

    // JOIN wallpapers skips events for wallpapers deleted after the event was accepted.
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        INSERT INTO wallpaper_events (wallpaper_id, type, platform, app_version, created_at)
        SELECT u.wallpaper_id, u.type, u.platform, u.app_version, u.created_at
        FROM unnest(
          ${batch.map((e) => e.wallpaperId)}::uuid[],
          ${batch.map((e) => e.type)}::"WallpaperEventType"[],
          ${batch.map((e) => e.platform)}::"ClientPlatform"[],
          ${batch.map((e) => e.appVersion)}::varchar[],
          ${batch.map((e) => e.createdAt)}::timestamptz[]
        ) WITH ORDINALITY AS u(wallpaper_id, type, platform, app_version, created_at, ord)
        JOIN wallpapers w ON w.id = u.wallpaper_id
        ORDER BY u.ord`,
      this.prisma.$executeRaw`
        INSERT INTO wallpaper_daily_stats (wallpaper_id, date, views, download_clicks, downloads)
        SELECT u.wallpaper_id, u.date, u.views, u.clicks, u.downloads
        FROM unnest(
          ${dailyRows.map((r) => r.wallpaperId)}::uuid[],
          ${dailyRows.map((r) => r.date)}::date[],
          ${dailyRows.map((r) => r.views)}::int[],
          ${dailyRows.map((r) => r.clicks)}::int[],
          ${dailyRows.map((r) => r.downloads)}::int[]
        ) AS u(wallpaper_id, date, views, clicks, downloads)
        JOIN wallpapers w ON w.id = u.wallpaper_id
        ON CONFLICT (wallpaper_id, date) DO UPDATE SET
          views = wallpaper_daily_stats.views + EXCLUDED.views,
          download_clicks = wallpaper_daily_stats.download_clicks + EXCLUDED.download_clicks,
          downloads = wallpaper_daily_stats.downloads + EXCLUDED.downloads`,
      this.prisma.$executeRaw`
        UPDATE wallpapers w SET
          view_count = w.view_count + u.views,
          download_click_count = w.download_click_count + u.clicks,
          download_count = w.download_count + u.downloads
        FROM unnest(
          ${totalRows.map(([id]) => id)}::uuid[],
          ${totalRows.map(([, t]) => t.views)}::int[],
          ${totalRows.map(([, t]) => t.clicks)}::int[],
          ${totalRows.map(([, t]) => t.downloads)}::int[]
        ) AS u(id, views, clicks, downloads)
        WHERE w.id = u.id`,
    ] satisfies Prisma.PrismaPromise<number>[]);
  }

  private enqueue(event: BufferedEvent): void {
    if (this.buffer.length >= MAX_BUFFERED_EVENTS) {
      this.buffer.shift();
      this.droppedSinceLastFlush++;
    }
    this.buffer.push(event);
  }

  private dedupeKey(ip: string, wallpaperId: string, type: WallpaperEventType): string {
    return createHash('sha256').update(this.salt).update(`${ip}|${wallpaperId}|${type}`).digest('base64url').slice(0, 22);
  }

  private sweepDedupe(now: number): void {
    if (this.dedupe.size < MAX_DEDUPE_ENTRIES * 0.9) return;
    for (const [key, until] of this.dedupe) if (until <= now) this.dedupe.delete(key);
  }
}
