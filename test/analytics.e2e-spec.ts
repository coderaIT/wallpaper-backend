import { AnalyticsIngestService } from '../src/modules/analytics/analytics-ingest.service';
import { adminSession, API, createTestApp, LoggedIn, resetDatabase, TestContext, uploadMedia } from './utils/test-app';

const MISSING = '00000000-0000-4000-8000-000000000000';
const today = () => new Date().toISOString().slice(0, 10);

describe('Analytics (e2e)', () => {
  let ctx: TestContext;
  let ingest: AnalyticsIngestService;
  let session: LoggedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
    ingest = ctx.app.get(AnalyticsIngestService);
  });

  beforeEach(async () => {
    await ingest.flush();
    await resetDatabase(ctx.prisma);
    ctx.storage.reset();
    session = await adminSession(ctx, 'EDITOR');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const wallpaper = async (body: Record<string, unknown>) => {
    const mediaId = await uploadMedia(ctx, session);
    return (await ctx.http().post(`${API}/admin/wallpapers`).set(session.auth).send({ mediaId, ...body }).expect(201)).body.data.id as string;
  };

  const track = (events: Record<string, unknown>[], ip = '203.0.113.1', status = 202) =>
    ctx.http().post(`${API}/public/events`).set('X-Forwarded-For', ip).send({ events }).expect(status);

  it('validates event batches', async () => {
    const w = await wallpaper({ title: 'W', isPublished: true });
    await track([], undefined, 400);
    await track(Array.from({ length: 51 }, () => ({ wallpaperId: w, type: 'WALLPAPER_VIEW' })), undefined, 400);
    await track([{ wallpaperId: w, type: 'WALLPAPER_LIKE' }], undefined, 400);
    await track([{ wallpaperId: 'nope', type: 'WALLPAPER_VIEW' }], undefined, 400);
    await track([{ wallpaperId: w, type: 'WALLPAPER_VIEW', userId: 'x' }], undefined, 400);
    await track([{ wallpaperId: w, type: 'WALLPAPER_VIEW', appVersion: 'latest' }], undefined, 400);
    await ctx.http().post(`${API}/public/events`).send({ events: 'x' }).expect(400);
  });

  it('accepts only published wallpapers, dedupes per client and aggregates on flush', async () => {
    const w = await wallpaper({ title: 'W', isPublished: true });
    const draft = await wallpaper({ title: 'Draft', isPublished: false });

    const res = await track([
      { wallpaperId: w, type: 'WALLPAPER_VIEW', platform: 'ANDROID', appVersion: '1.2.3' },
      { wallpaperId: w, type: 'WALLPAPER_VIEW' },
      { wallpaperId: draft, type: 'WALLPAPER_VIEW' },
      { wallpaperId: MISSING, type: 'WALLPAPER_VIEW' },
      { wallpaperId: w, type: 'WALLPAPER_DOWNLOAD_CLICK', platform: 'ANDROID' },
      { wallpaperId: w, type: 'WALLPAPER_DOWNLOAD', platform: 'ANDROID' },
    ]);
    expect(res.body.data).toEqual({ accepted: 3, duplicates: 1, rejected: 2 });

    expect((await track([{ wallpaperId: w, type: 'WALLPAPER_VIEW' }])).body.data).toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
    expect((await track([{ wallpaperId: w, type: 'WALLPAPER_VIEW', platform: 'IOS' }], '203.0.113.2')).body.data.accepted).toBe(1);

    // Nothing is written until the buffer is flushed.
    expect(await ctx.prisma.wallpaperEvent.count()).toBe(0);
    await ingest.flush();

    const stored = await ctx.prisma.wallpaper.findUniqueOrThrow({ where: { id: w } });
    expect(stored).toMatchObject({ viewCount: 2, downloadClickCount: 1, downloadCount: 1 });
    const daily = await ctx.prisma.wallpaperDailyStat.findMany();
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ wallpaperId: w, views: 2, downloadClicks: 1, downloads: 1 });
    expect(daily[0].date.toISOString().slice(0, 10)).toBe(today());

    const raw = await ctx.prisma.wallpaperEvent.findMany({ orderBy: { id: 'asc' } });
    expect(raw).toHaveLength(4);
    expect(raw[0]).toMatchObject({ wallpaperId: w, type: 'WALLPAPER_VIEW', platform: 'ANDROID', appVersion: '1.2.3' });
    const columns = await ctx.prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'wallpaper_events'`;
    expect(columns.map((c) => c.column_name).sort()).toEqual(['app_version', 'created_at', 'id', 'platform', 'type', 'wallpaper_id']);

    // A second flush merges into the same daily row.
    await track([{ wallpaperId: w, type: 'WALLPAPER_DOWNLOAD' }], '203.0.113.3');
    await ingest.flush();
    expect((await ctx.prisma.wallpaperDailyStat.findFirstOrThrow()).downloads).toBe(2);
    expect((await ctx.prisma.wallpaper.findUniqueOrThrow({ where: { id: w } })).downloadCount).toBe(2);
  });

  it('feeds the public popular ordering', async () => {
    const a = await wallpaper({ title: 'A', isPublished: true });
    const b = await wallpaper({ title: 'B', isPublished: true });
    await track([{ wallpaperId: b, type: 'WALLPAPER_DOWNLOAD' }], '198.51.100.1');
    await track([{ wallpaperId: b, type: 'WALLPAPER_DOWNLOAD' }], '198.51.100.2');
    await track([{ wallpaperId: a, type: 'WALLPAPER_DOWNLOAD' }], '198.51.100.3');
    await ingest.flush();
    const res = await ctx.http().get(`${API}/public/wallpapers/popular`).expect(200);
    expect(res.body.data.map((w: { id: string }) => w.id)).toEqual([b, a]);
  });

  it('skips events for wallpapers deleted before the flush', async () => {
    const w = await wallpaper({ title: 'Gone', isPublished: true });
    await track([{ wallpaperId: w, type: 'WALLPAPER_VIEW' }]);
    await ctx.http().delete(`${API}/admin/wallpapers/${w}`).set(session.auth).expect(204);
    await ingest.flush();
    expect(ingest.pendingCount).toBe(0);
    expect(await ctx.prisma.wallpaperEvent.count()).toBe(0);
    expect(await ctx.prisma.wallpaperDailyStat.count()).toBe(0);
  });

  it('prunes raw events past retention but keeps aggregates', async () => {
    const w = await wallpaper({ title: 'Old', isPublished: true });
    await ctx.prisma.wallpaperEvent.createMany({
      data: [
        { wallpaperId: w, type: 'WALLPAPER_VIEW', createdAt: new Date(Date.now() - 100 * 86_400_000) },
        { wallpaperId: w, type: 'WALLPAPER_VIEW' },
      ],
    });
    await ctx.prisma.wallpaperDailyStat.create({ data: { wallpaperId: w, date: new Date('2020-01-01'), views: 5 } });
    expect(await ingest.pruneRawEvents()).toBe(1);
    expect(await ctx.prisma.wallpaperEvent.count()).toBe(1);
    expect(await ctx.prisma.wallpaperDailyStat.count()).toBe(1);
  });

  it('serves admin reports with validated date ranges', async () => {
    const cat = (await ctx.http().post(`${API}/admin/categories`).set(session.auth).send({ name: 'Nature', isPublished: true }).expect(201)).body.data.id;
    const a = await wallpaper({ title: 'A', isPublished: true, categoryIds: [cat] });
    const b = await wallpaper({ title: 'B', isPublished: true });
    await track(
      [
        { wallpaperId: a, type: 'WALLPAPER_VIEW', platform: 'ANDROID' },
        { wallpaperId: a, type: 'WALLPAPER_DOWNLOAD_CLICK', platform: 'ANDROID' },
        { wallpaperId: a, type: 'WALLPAPER_DOWNLOAD', platform: 'ANDROID' },
        { wallpaperId: b, type: 'WALLPAPER_VIEW', platform: 'IOS' },
        { wallpaperId: b, type: 'WALLPAPER_DOWNLOAD_CLICK', platform: 'IOS' },
      ],
      '192.0.2.10',
    );
    await ingest.flush();

    await ctx.http().get(`${API}/admin/analytics/overview`).expect(401);
    const overview = await ctx.http().get(`${API}/admin/analytics/overview`).set(session.auth).expect(200);
    expect(overview.body.data.totals).toEqual({ views: 2, downloadClicks: 2, downloads: 1 });
    expect(overview.body.data.allTime).toEqual({ views: 2, downloadClicks: 2, downloads: 1 });
    expect(overview.body.data.series).toHaveLength(30);
    expect(overview.body.data.series.at(-1)).toEqual({ date: today(), views: 2, downloadClicks: 2, downloads: 1 });
    expect(overview.body.data.previousPeriod).toMatchObject({ views: 0, downloads: 0 });

    const downloads = await ctx.http().get(`${API}/admin/analytics/downloads?from=${today()}&to=${today()}`).set(session.auth).expect(200);
    expect(downloads.body.data.totals).toEqual({ downloadClicks: 2, downloads: 1, conversionRate: 0.5 });
    expect(downloads.body.data.byPlatform).toEqual([
      { platform: 'ANDROID', downloadClicks: 1, downloads: 1 },
      { platform: 'IOS', downloadClicks: 1, downloads: 0 },
    ]);

    const popular = await ctx.http().get(`${API}/admin/analytics/popular-wallpapers?metric=downloadClicks&limit=5`).set(session.auth).expect(200);
    expect(popular.body.data.items).toHaveLength(2);
    expect(popular.body.data.items[0].wallpaper).toMatchObject({ isPublished: true });
    expect(popular.body.data.items[0].wallpaper.thumbnailUrl).toMatch(/thumbnail\.webp$/);
    const byDownloads = await ctx.http().get(`${API}/admin/analytics/popular-wallpapers`).set(session.auth).expect(200);
    expect(byDownloads.body.data.items[0].wallpaper.id).toBe(a);

    const cats = await ctx.http().get(`${API}/admin/analytics/popular-categories`).set(session.auth).expect(200);
    expect(cats.body.data.items).toEqual([{ category: { id: cat, name: 'Nature', slug: 'nature' }, views: 1, downloadClicks: 1, downloads: 1 }]);

    await ctx.http().get(`${API}/admin/analytics/overview?from=2026-02-30`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/analytics/overview?from=2026-03-01&to=2026-02-01`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/analytics/overview?from=2024-01-01&to=2026-01-01`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/analytics/overview?from=01-01-2026`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/analytics/popular-wallpapers?metric=revenue`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/analytics/popular-wallpapers?limit=1000`).set(session.auth).expect(400);
  });

  it('flushes buffered events on shutdown', async () => {
    const w = await wallpaper({ title: 'Shutdown', isPublished: true });
    const other = await createTestApp();
    try {
      await other.http().post(`${API}/public/events`).set('X-Forwarded-For', '192.0.2.99').send({ events: [{ wallpaperId: w, type: 'WALLPAPER_VIEW' }] }).expect(202);
      expect(await ctx.prisma.wallpaperEvent.count()).toBe(0);
    } finally {
      await other.app.close();
    }
    expect(await ctx.prisma.wallpaperEvent.count()).toBe(1);
  });
});
