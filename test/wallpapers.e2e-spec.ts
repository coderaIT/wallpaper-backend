import { makeJpeg } from './utils/images';
import { adminSession, API, createTestApp, LoggedIn, resetDatabase, TestContext, uploadMedia } from './utils/test-app';

describe('Wallpaper management (e2e)', () => {
  let ctx: TestContext;
  let session: LoggedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.storage.reset();
    session = await adminSession(ctx, 'EDITOR');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const category = async (name: string) =>
    (await ctx.http().post(`${API}/admin/categories`).set(session.auth).send({ name, isPublished: true }).expect(201)).body.data.id as string;

  const wallpaper = async (body: Record<string, unknown>, status: number) => {
    const mediaId = (body.mediaId as string | undefined) ?? (await uploadMedia(ctx, session));
    return ctx.http().post(`${API}/admin/wallpapers`).set(session.auth).send({ mediaId, ...body }).expect(status);
  };

  it('creates a wallpaper with multiple categories and derived dimensions', async () => {
    const nature = await category('Nature');
    const dark = await category('Dark');
    const mediaId = await uploadMedia(ctx, session, 400, 800);
    const res = await wallpaper({ title: 'Night Forest', mediaId, categoryIds: [nature, dark], tags: ['Forest', 'night', 'forest'] }, 201);

    expect(res.body.data).toMatchObject({
      title: 'Night Forest',
      slug: 'night-forest',
      width: 400,
      height: 800,
      orientation: 'PORTRAIT',
      isPublished: false,
      publishedAt: null,
      tags: ['forest', 'night'],
    });
    expect(res.body.data.categories.map((c: { id: string }) => c.id).sort()).toEqual([nature, dark].sort());
    expect(res.body.data.image.mediaId).toBe(mediaId);
    expect(res.body.data.image.previewUrl).toMatch(/preview\.webp$/);
  });

  it('validates references and input', async () => {
    await wallpaper({ title: 'X', mediaId: '00000000-0000-4000-8000-000000000000' }, 404);
    await wallpaper({ title: 'X', categoryIds: ['00000000-0000-4000-8000-000000000000'] }, 404);
    await wallpaper({ title: '' }, 400);
    await wallpaper({ title: 'X', isPublished: 'yes' }, 400);
    await wallpaper({ title: 'X', categoryIds: ['nope'] }, 400);
    await ctx.http().get(`${API}/admin/wallpapers/xyz`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/wallpapers/00000000-0000-4000-8000-000000000000`).set(session.auth).expect(404);
  });

  it('updates metadata and replaces / removes category assignments', async () => {
    const a = await category('A');
    const b = await category('B');
    const id = (await wallpaper({ title: 'Old', categoryIds: [a] }, 201)).body.data.id;

    const updated = await ctx
      .http()
      .patch(`${API}/admin/wallpapers/${id}`)
      .set(session.auth)
      .send({ title: 'New', description: 'desc', categoryIds: [b], isFeatured: true, sortOrder: 7 })
      .expect(200);
    expect(updated.body.data).toMatchObject({ title: 'New', description: 'desc', isFeatured: true, sortOrder: 7 });
    expect(updated.body.data.categories.map((c: { id: string }) => c.id)).toEqual([b]);

    const cleared = await ctx.http().patch(`${API}/admin/wallpapers/${id}`).set(session.auth).send({ categoryIds: [] }).expect(200);
    expect(cleared.body.data.categories).toEqual([]);

    const landscape = await uploadMedia(ctx, session, 900, 300);
    const swapped = await ctx.http().patch(`${API}/admin/wallpapers/${id}`).set(session.auth).send({ mediaId: landscape }).expect(200);
    expect(swapped.body.data).toMatchObject({ orientation: 'LANDSCAPE', width: 900, height: 300 });
  });

  it('publishes and unpublishes, setting publishedAt once', async () => {
    const id = (await wallpaper({ title: 'P' }, 201)).body.data.id;
    const pub = await ctx.http().patch(`${API}/admin/wallpapers/${id}/publish`).set(session.auth).send({ isPublished: true }).expect(200);
    expect(pub.body.data.isPublished).toBe(true);
    const firstPublishedAt = pub.body.data.publishedAt;
    expect(firstPublishedAt).not.toBeNull();

    const unpub = await ctx.http().patch(`${API}/admin/wallpapers/${id}/publish`).set(session.auth).send({ isPublished: false }).expect(200);
    expect(unpub.body.data.isPublished).toBe(false);
    const again = await ctx.http().patch(`${API}/admin/wallpapers/${id}/publish`).set(session.auth).send({ isPublished: true }).expect(200);
    expect(again.body.data.publishedAt).toBe(firstPublishedAt);

    expect(await ctx.prisma.auditLog.count({ where: { entityId: id, action: 'WALLPAPER_PUBLISHED' } })).toBe(2);
    expect(await ctx.prisma.auditLog.count({ where: { entityId: id, action: 'WALLPAPER_UNPUBLISHED' } })).toBe(1);
  });

  it('searches, filters, sorts and paginates', async () => {
    const nature = await category('Nature');
    await wallpaper({ title: 'Blue Ocean', categoryIds: [nature], isPublished: true, tags: ['water'] }, 201);
    await wallpaper({ title: 'Red Desert', isPublished: false }, 201);
    const landscapeMedia = await uploadMedia(ctx, session, 800, 400);
    await wallpaper({ title: 'Green Valley', mediaId: landscapeMedia, categoryIds: [nature], isPublished: true }, 201);

    const all = await ctx.http().get(`${API}/admin/wallpapers?limit=2&page=1&sortBy=title&sortDir=asc`).set(session.auth).expect(200);
    expect(all.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(all.body.data.map((w: { title: string }) => w.title)).toEqual(['Blue Ocean', 'Green Valley']);

    const search = await ctx.http().get(`${API}/admin/wallpapers?search=desert`).set(session.auth).expect(200);
    expect(search.body.data.map((w: { title: string }) => w.title)).toEqual(['Red Desert']);
    const byTag = await ctx.http().get(`${API}/admin/wallpapers?search=WATER`).set(session.auth).expect(200);
    expect(byTag.body.data.map((w: { title: string }) => w.title)).toEqual(['Blue Ocean']);

    const byCategory = await ctx.http().get(`${API}/admin/wallpapers?categoryId=${nature}`).set(session.auth).expect(200);
    expect(byCategory.body.meta.total).toBe(2);
    const drafts = await ctx.http().get(`${API}/admin/wallpapers?isPublished=false`).set(session.auth).expect(200);
    expect(drafts.body.data.map((w: { title: string }) => w.title)).toEqual(['Red Desert']);
    const landscape = await ctx.http().get(`${API}/admin/wallpapers?orientation=LANDSCAPE`).set(session.auth).expect(200);
    expect(landscape.body.data.map((w: { title: string }) => w.title)).toEqual(['Green Valley']);

    const viaCategory = await ctx.http().get(`${API}/admin/categories/${nature}/wallpapers?isPublished=true`).set(session.auth).expect(200);
    expect(viaCategory.body.meta.total).toBe(2);

    await ctx.http().get(`${API}/admin/wallpapers?sortBy=passwordHash`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/wallpapers?orientation=DIAGONAL`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/wallpapers?page=0`).set(session.auth).expect(400);
  });

  it('deleting a category keeps its wallpapers', async () => {
    const cat = await category('Temp');
    const id = (await wallpaper({ title: 'Survivor', categoryIds: [cat] }, 201)).body.data.id;
    await ctx.http().delete(`${API}/admin/categories/${cat}`).set(session.auth).expect(204);

    const res = await ctx.http().get(`${API}/admin/wallpapers/${id}`).set(session.auth).expect(200);
    expect(res.body.data.categories).toEqual([]);
    expect(await ctx.prisma.wallpaper.count()).toBe(1);
    expect(await ctx.prisma.wallpaperCategory.count()).toBe(0);
  });

  it('bulk creates wallpapers from media with per-item errors', async () => {
    const cat = await category('Bulk');
    const m1 = await uploadMedia(ctx, session);
    const m2 = await uploadMedia(ctx, session);
    const res = await ctx
      .http()
      .post(`${API}/admin/wallpapers/bulk`)
      .set(session.auth)
      .send({
        items: [{ mediaId: m1, title: 'One' }, { mediaId: '00000000-0000-4000-8000-000000000000' }, { mediaId: m2 }],
        categoryIds: [cat],
        isPublished: true,
      })
      .expect(200);
    expect(res.body.data.succeeded).toBe(2);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.results[1]).toMatchObject({ index: 1, status: 'error', error: { statusCode: 404 } });
    expect(res.body.data.results[2].item.title).toBe('img');
    expect(await ctx.prisma.wallpaperCategory.count({ where: { categoryId: cat } })).toBe(2);
  });

  it('bulk updates with per-item results', async () => {
    const cat = await category('Group');
    const a = (await wallpaper({ title: 'A' }, 201)).body.data.id;
    const b = (await wallpaper({ title: 'B' }, 201)).body.data.id;
    const missing = '00000000-0000-4000-8000-000000000000';

    const pub = await ctx.http().patch(`${API}/admin/wallpapers/bulk`).set(session.auth).send({ action: 'PUBLISH', ids: [a, b, missing] }).expect(200);
    expect(pub.body.data).toMatchObject({ succeeded: 2, failed: 1 });
    expect(pub.body.data.results[2]).toEqual({ id: missing, status: 'error', error: { statusCode: 404, message: 'Wallpaper not found' } });
    expect(await ctx.prisma.wallpaper.count({ where: { isPublished: true, publishedAt: { not: null } } })).toBe(2);

    await ctx.http().patch(`${API}/admin/wallpapers/bulk`).set(session.auth).send({ action: 'ADD_CATEGORIES', ids: [a, b], categoryIds: [cat] }).expect(200);
    expect(await ctx.prisma.wallpaperCategory.count()).toBe(2);
    await ctx.http().patch(`${API}/admin/wallpapers/bulk`).set(session.auth).send({ action: 'REMOVE_CATEGORIES', ids: [a], categoryIds: [cat] }).expect(200);
    expect(await ctx.prisma.wallpaperCategory.count()).toBe(1);

    await ctx.http().patch(`${API}/admin/wallpapers/bulk`).set(session.auth).send({ action: 'FEATURE', ids: [b] }).expect(200);
    expect((await ctx.prisma.wallpaper.findUniqueOrThrow({ where: { id: b } })).isFeatured).toBe(true);

    await ctx.http().patch(`${API}/admin/wallpapers/bulk`).set(session.auth).send({ action: 'REORDER', items: [{ id: a, sortOrder: 9 }] }).expect(200);
    expect((await ctx.prisma.wallpaper.findUniqueOrThrow({ where: { id: a } })).sortOrder).toBe(9);

    await ctx.http().patch(`${API}/admin/wallpapers/bulk`).set(session.auth).send({ action: 'ADD_CATEGORIES', ids: [a] }).expect(400);
    await ctx.http().patch(`${API}/admin/wallpapers/bulk`).set(session.auth).send({ action: 'EXPLODE', ids: [a] }).expect(400);

    await ctx.http().patch(`${API}/admin/wallpapers/bulk`).set(session.auth).send({ action: 'DELETE', ids: [a, b] }).expect(200);
    expect(await ctx.prisma.wallpaper.count()).toBe(0);
    expect(await ctx.prisma.mediaAsset.count({ where: { variantType: 'ORIGINAL' } })).toBe(2);
  });

  it('deletes a wallpaper, optionally with its now-unused media', async () => {
    const keep = (await wallpaper({ title: 'Keep media' }, 201)).body.data;
    await ctx.http().delete(`${API}/admin/wallpapers/${keep.id}`).set(session.auth).expect(204);
    expect(await ctx.prisma.mediaAsset.count({ where: { id: keep.image.mediaId } })).toBe(1);

    const drop = (await wallpaper({ title: 'Drop media' }, 201)).body.data;
    await ctx.http().delete(`${API}/admin/wallpapers/${drop.id}?deleteMedia=true`).set(session.auth).expect(204);
    expect(await ctx.prisma.mediaAsset.count({ where: { id: drop.image.mediaId } })).toBe(0);
    await ctx.http().delete(`${API}/admin/wallpapers/${drop.id}`).set(session.auth).expect(404);
  });

  it('uploads files and creates wallpapers in one step, compensating on failure', async () => {
    const cat = await category('Uploads');
    const res = await ctx
      .http()
      .post(`${API}/admin/wallpapers/upload`)
      .set(session.auth)
      .field('categoryIds', cat)
      .field('isPublished', 'true')
      .attach('files', await makeJpeg(), { filename: 'sunset_beach.jpg', contentType: 'image/jpeg' })
      .attach('files', Buffer.from('garbage'), { filename: 'broken.jpg', contentType: 'image/jpeg' })
      .expect(200);
    expect(res.body.data.succeeded).toBe(1);
    expect(res.body.data.results[0].item).toMatchObject({ title: 'sunset beach', isPublished: true });
    expect(res.body.data.results[0].item.categories[0].id).toBe(cat);
    expect(res.body.data.results[1]).toMatchObject({ status: 'error', filename: 'broken.jpg' });
    expect(await ctx.prisma.mediaAsset.count({ where: { variantType: 'ORIGINAL' } })).toBe(1);
  });
});
