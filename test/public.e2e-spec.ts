import { adminSession, API, createTestApp, LoggedIn, resetDatabase, TestContext, uploadMedia } from './utils/test-app';

describe('Public catalog API (e2e)', () => {
  let ctx: TestContext;
  let session: LoggedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.storage.reset();
    session = await adminSession(ctx, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const category = async (name: string, isPublished = true) =>
    (await ctx.http().post(`${API}/admin/categories`).set(session.auth).send({ name, isPublished }).expect(201)).body.data as {
      id: string;
      slug: string;
    };

  const wallpaper = async (body: Record<string, unknown>, size: [number, number] = [400, 800]) => {
    const mediaId = await uploadMedia(ctx, session, size[0], size[1]);
    const res = await ctx.http().post(`${API}/admin/wallpapers`).set(session.auth).send({ mediaId, ...body }).expect(201);
    return res.body.data as { id: string; slug: string };
  };

  it('never returns unpublished wallpapers and exposes only allowlisted fields', async () => {
    const pub = await wallpaper({ title: 'Visible', isPublished: true });
    const hidden = await wallpaper({ title: 'Hidden', isPublished: false });

    const list = await ctx.http().get(`${API}/public/wallpapers`).expect(200);
    expect(list.body.data.map((w: { id: string }) => w.id)).toEqual([pub.id]);
    expect(list.body.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(Object.keys(list.body.data[0]).sort()).toEqual(
      ['id', 'title', 'slug', 'thumbnailUrl', 'previewUrl', 'width', 'height', 'orientation', 'isFeatured'].sort(),
    );
    expect(list.body.data[0].thumbnailUrl).toMatch(/^https:\/\/cdn\.test\.local\/media\//);

    await ctx.http().get(`${API}/public/wallpapers/${hidden.id}`).expect(404);
    const detail = await ctx.http().get(`${API}/public/wallpapers/${pub.id}`).expect(200);
    const serialized = JSON.stringify(detail.body);
    for (const forbidden of ['viewCount', 'downloadCount', 'storageKey', 'checksum', 'uploadedBy', 'createdBy', 'isPublished']) {
      expect(serialized).not.toContain(forbidden);
    }

    for (const path of ['featured', 'latest', 'popular']) {
      const res = await ctx.http().get(`${API}/public/wallpapers/${path}`).expect(200);
      expect(res.body.data.every((w: { id: string }) => w.id !== hidden.id)).toBe(true);
    }

    // Unpublishing removes it immediately (test env disables caching).
    await ctx.http().patch(`${API}/admin/wallpapers/${pub.id}/publish`).set(session.auth).send({ isPublished: false }).expect(200);
    await ctx.http().get(`${API}/public/wallpapers/${pub.id}`).expect(404);
  });

  it('paginates and validates query parameters', async () => {
    for (let i = 0; i < 3; i++) await wallpaper({ title: `Wall ${i}`, isPublished: true });
    const p1 = await ctx.http().get(`${API}/public/wallpapers?page=1&limit=2`).expect(200);
    const p2 = await ctx.http().get(`${API}/public/wallpapers?page=2&limit=2`).expect(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p2.body.data).toHaveLength(1);
    expect(p1.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    const ids = new Set([...p1.body.data, ...p2.body.data].map((w: { id: string }) => w.id));
    expect(ids.size).toBe(3);

    await ctx.http().get(`${API}/public/wallpapers?limit=101`).expect(400);
    await ctx.http().get(`${API}/public/wallpapers?page=0`).expect(400);
    await ctx.http().get(`${API}/public/wallpapers?sort=random`).expect(400);
    await ctx.http().get(`${API}/public/wallpapers?unknown=1`).expect(400);
    await ctx.http().get(`${API}/public/wallpapers/not-a-uuid`).expect(400);
  });

  it('filters by published category only and counts only published wallpapers', async () => {
    const nature = await category('Nature');
    const secret = await category('Secret', false);
    await wallpaper({ title: 'Forest', isPublished: true, categoryIds: [nature.id] });
    await wallpaper({ title: 'Draft Forest', isPublished: false, categoryIds: [nature.id] });
    await wallpaper({ title: 'Hidden Cat', isPublished: true, categoryIds: [secret.id] });

    const cats = await ctx.http().get(`${API}/public/categories`).expect(200);
    expect(cats.body.data).toHaveLength(1);
    expect(cats.body.data[0]).toMatchObject({ slug: 'nature', wallpaperCount: 1 });

    const bySlug = await ctx.http().get(`${API}/public/wallpapers?categorySlug=nature`).expect(200);
    expect(bySlug.body.data.map((w: { title: string }) => w.title)).toEqual(['Forest']);
    const byId = await ctx.http().get(`${API}/public/wallpapers?categoryId=${nature.id}`).expect(200);
    expect(byId.body.meta.total).toBe(1);

    await ctx.http().get(`${API}/public/categories/secret`).expect(404);
    await ctx.http().get(`${API}/public/wallpapers?categoryId=${secret.id}`).expect(404);
    await ctx.http().get(`${API}/public/categories/nature`).expect(200);
    await ctx.http().get(`${API}/public/categories/Bad_Slug!`).expect(400);

    // Detail only lists published categories.
    const both = await wallpaper({ title: 'Both', isPublished: true, categoryIds: [nature.id, secret.id] });
    const detail = await ctx.http().get(`${API}/public/wallpapers/${both.id}`).expect(200);
    expect(detail.body.data.categories.map((c: { slug: string }) => c.slug)).toEqual(['nature']);
  });

  it('searches by title and tag and filters orientation', async () => {
    await wallpaper({ title: 'Mountain Sunrise', isPublished: true, tags: ['alps'] });
    await wallpaper({ title: 'Ocean Waves', isPublished: true, tags: ['sea'] }, [800, 400]);
    await wallpaper({ title: 'Mountain Draft', isPublished: false });

    const byTitle = await ctx.http().get(`${API}/public/wallpapers/search?q=mountain`).expect(200);
    expect(byTitle.body.data.map((w: { title: string }) => w.title)).toEqual(['Mountain Sunrise']);
    const byTag = await ctx.http().get(`${API}/public/wallpapers/search?q=sea`).expect(200);
    expect(byTag.body.data.map((w: { title: string }) => w.title)).toEqual(['Ocean Waves']);
    const landscape = await ctx.http().get(`${API}/public/wallpapers?orientation=LANDSCAPE`).expect(200);
    expect(landscape.body.data.map((w: { title: string }) => w.title)).toEqual(['Ocean Waves']);

    await ctx.http().get(`${API}/public/wallpapers/search`).expect(400);
    await ctx.http().get(`${API}/public/wallpapers/search?q=a`).expect(400);
    await ctx.http().get(`${API}/public/wallpapers/search?q=${'x'.repeat(101)}`).expect(400);
    // LIKE wildcards are treated literally.
    const wildcard = await ctx.http().get(`${API}/public/wallpapers/search?q=%25%25`).expect(200);
    expect(wildcard.body.data).toHaveLength(0);
    const underscore = await ctx.http().get(`${API}/public/wallpapers/search?q=__`).expect(200);
    expect(underscore.body.data).toHaveLength(0);
    await wallpaper({ title: '100% Pure_Black', isPublished: true });
    const literal = await ctx.http().get(`${API}/public/wallpapers/search?q=0%25%20pure_b`).expect(200);
    expect(literal.body.data.map((w: { title: string }) => w.title)).toEqual(['100% Pure_Black']);
  });

  it('derives downloadUrl from settings', async () => {
    const w = await wallpaper({ title: 'Dl', isPublished: true });
    const url = async () => (await ctx.http().get(`${API}/public/wallpapers/${w.id}`).expect(200)).body.data.downloadUrl as string | null;

    expect(await url()).toMatch(/original\.jpg$/);
    await ctx.http().patch(`${API}/admin/settings`).set(session.auth).send({ downloads: { allowOriginalDownload: false } }).expect(200);
    expect(await url()).toMatch(/preview\.webp$/);
    await ctx.http().patch(`${API}/admin/settings`).set(session.auth).send({ downloads: { enabled: false } }).expect(200);
    expect(await url()).toBeNull();
  });

  it('sets cache headers and exposes no write routes', async () => {
    // PUBLIC_CACHE_TTL_SECONDS=0 in the test env; with a positive TTL this is `public, max-age=<ttl>, ...`.
    const res = await ctx.http().get(`${API}/public/categories`).expect(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    await ctx.http().get(`${API}/public/wallpapers/00000000-0000-4000-8000-000000000000`).expect(404)
      .expect((r) => expect(r.headers['cache-control']).toBeUndefined());

    await ctx.http().post(`${API}/public/wallpapers`).send({ title: 'x' }).expect(404);
    await ctx.http().patch(`${API}/public/categories/nature`).send({}).expect(404);
    await ctx.http().delete(`${API}/public/wallpapers/00000000-0000-4000-8000-000000000000`).expect(404);
  });
});
