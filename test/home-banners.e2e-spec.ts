import { adminSession, API, createTestApp, LoggedIn, resetDatabase, TestContext, uploadMedia } from './utils/test-app';

const MISSING = '00000000-0000-4000-8000-000000000000';

describe('Home sections, banners & home feed (e2e)', () => {
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

  const category = async (name: string, isPublished = true) =>
    (await ctx.http().post(`${API}/admin/categories`).set(session.auth).send({ name, isPublished }).expect(201)).body.data.id as string;

  const wallpaper = async (body: Record<string, unknown>) => {
    const mediaId = await uploadMedia(ctx, session);
    return (await ctx.http().post(`${API}/admin/wallpapers`).set(session.auth).send({ mediaId, ...body }).expect(201)).body.data.id as string;
  };

  const section = (body: Record<string, unknown>, status = 201) =>
    ctx.http().post(`${API}/admin/home-sections`).set(session.auth).send(body).expect(status);

  const banner = (body: Record<string, unknown>, status = 201) =>
    ctx.http().post(`${API}/admin/banners`).set(session.auth).send(body).expect(status);

  const home = async () =>
    (await ctx.http().get(`${API}/public/home`).expect(200)).body.data.sections as {
      id: string;
      type: string;
      title: string;
      items: { id: string; action?: Record<string, unknown> }[];
      category?: { id: string };
    }[];

  describe('home sections admin', () => {
    it('validates configuration per section type', async () => {
      const cat = await category('Nature');
      await section({ title: 'X', sectionType: 'CATEGORY_WALLPAPERS', configuration: {} }, 400);
      await section({ title: 'X', sectionType: 'CATEGORY_WALLPAPERS', configuration: { categoryId: MISSING } }, 404);
      await section({ title: 'X', sectionType: 'LATEST_WALLPAPERS', configuration: { limit: 0 } }, 400);
      await section({ title: 'X', sectionType: 'LATEST_WALLPAPERS', configuration: { limit: 10, evil: true } }, 400);
      await section({ title: 'X', sectionType: 'CUSTOM_WALLPAPERS', configuration: { wallpaperIds: [] } }, 400);
      await section({ title: 'X', sectionType: 'CUSTOM_WALLPAPERS', configuration: { wallpaperIds: [MISSING] } }, 404);
      await section({ title: 'X', sectionType: 'NOPE' }, 400);

      const res = await section({ title: 'Nature', sectionType: 'CATEGORY_WALLPAPERS', configuration: { categoryId: cat, limit: 5, sort: 'popular' } });
      expect(res.body.data).toMatchObject({ title: 'Nature', isEnabled: true, configuration: { categoryId: cat, limit: 5, sort: 'popular' } });

      // Changing the type re-validates the existing configuration.
      await ctx.http().patch(`${API}/admin/home-sections/${res.body.data.id}`).set(session.auth).send({ sectionType: 'CUSTOM_WALLPAPERS' }).expect(400);
    });

    it('reorders, updates and deletes sections with audit logs', async () => {
      const a = (await section({ title: 'A', sectionType: 'LATEST_WALLPAPERS' })).body.data.id;
      const b = (await section({ title: 'B', sectionType: 'POPULAR_WALLPAPERS' })).body.data.id;
      await ctx
        .http()
        .patch(`${API}/admin/home-sections/reorder`)
        .set(session.auth)
        .send({ items: [{ id: a, sortOrder: 1 }, { id: b, sortOrder: 0 }] })
        .expect(200);
      const list = await ctx.http().get(`${API}/admin/home-sections`).set(session.auth).expect(200);
      expect(list.body.data.map((s: { title: string }) => s.title)).toEqual(['B', 'A']);

      await ctx.http().patch(`${API}/admin/home-sections/reorder`).set(session.auth).send({ items: [{ id: a, sortOrder: 1 }, { id: a, sortOrder: 2 }] }).expect(400);
      await ctx.http().patch(`${API}/admin/home-sections/${a}`).set(session.auth).send({ isEnabled: false }).expect(200);
      await ctx.http().delete(`${API}/admin/home-sections/${b}`).set(session.auth).expect(204);
      await ctx.http().get(`${API}/admin/home-sections/${b}`).set(session.auth).expect(404);

      const actions = (await ctx.prisma.auditLog.findMany({ where: { entityType: 'HOME_SECTION' } })).map((l) => l.action).sort();
      expect(actions).toEqual(
        ['HOME_SECTION_CREATED', 'HOME_SECTION_CREATED', 'HOME_SECTION_DELETED', 'HOME_SECTION_REORDERED', 'HOME_SECTION_UPDATED'].sort(),
      );
    });
  });

  describe('banners admin', () => {
    it('validates action types, targets, URLs and schedule', async () => {
      const imageMediaId = await uploadMedia(ctx, session, 800, 400);
      const base = { title: 'Promo', imageMediaId };
      await banner({ ...base, actionType: 'NONE', actionValue: 'x' }, 400);
      await banner({ ...base, actionType: 'OPEN_WALLPAPER', actionValue: 'nope' }, 400);
      await banner({ ...base, actionType: 'OPEN_WALLPAPER', actionValue: MISSING }, 404);
      await banner({ ...base, actionType: 'OPEN_CATEGORY', actionValue: MISSING }, 404);
      await banner({ ...base, actionType: 'OPEN_URL', actionValue: 'http://example.com' }, 400);
      await banner({ ...base, actionType: 'OPEN_URL', actionValue: 'javascript:alert(1)' }, 400);
      await banner({ ...base, actionType: 'OPEN_URL', actionValue: 'https://192.168.1.1/x' }, 400);
      await banner({ ...base, actionType: 'OPEN_URL', actionValue: 'https://localhost/x' }, 400);
      await banner({ ...base, actionType: 'OPEN_URL', actionValue: 'https://user:pw@example.com/' }, 400);
      await banner({ title: 'X', imageMediaId: MISSING, actionType: 'NONE' }, 404);
      await banner({ ...base, actionType: 'NONE', startsAt: '2026-02-01T00:00:00.000Z', endsAt: '2026-01-01T00:00:00.000Z' }, 400);

      const ok = await banner({ ...base, actionType: 'OPEN_URL', actionValue: 'https://example.com/promo', isActive: true });
      expect(ok.body.data).toMatchObject({ actionType: 'OPEN_URL', actionValue: 'https://example.com/promo', isActive: true, sortOrder: 0 });
      expect(ok.body.data.image.previewUrl).toMatch(/preview\.webp$/);

      // Switching the action type without a valid value is rejected.
      await ctx.http().patch(`${API}/admin/banners/${ok.body.data.id}`).set(session.auth).send({ actionType: 'OPEN_CATEGORY' }).expect(400);
      // Media referenced by a banner cannot be deleted.
      await ctx.http().delete(`${API}/admin/media/${imageMediaId}`).set(session.auth).expect(409);
    });
  });

  describe('public home feed', () => {
    it('assembles enabled sections in order with only published content', async () => {
      const nature = await category('Nature');
      const hiddenCat = await category('Hidden', false);
      const w1 = await wallpaper({ title: 'One', isPublished: true, isFeatured: true, categoryIds: [nature] });
      const w2 = await wallpaper({ title: 'Two', isPublished: true, categoryIds: [nature] });
      const draft = await wallpaper({ title: 'Draft', isPublished: false, isFeatured: true, categoryIds: [nature] });

      const imageMediaId = await uploadMedia(ctx, session, 800, 400);
      await banner({ title: 'To wallpaper', imageMediaId, actionType: 'OPEN_WALLPAPER', actionValue: w1, isActive: true });
      await banner({ title: 'To draft', imageMediaId, actionType: 'OPEN_WALLPAPER', actionValue: draft, isActive: true });
      await banner({ title: 'Inactive', imageMediaId, actionType: 'NONE', isActive: false });
      await banner({ title: 'Future', imageMediaId, actionType: 'NONE', isActive: true, startsAt: '2999-01-01T00:00:00.000Z' });
      await banner({ title: 'Expired', imageMediaId, actionType: 'NONE', isActive: true, endsAt: '2000-01-01T00:00:00.000Z' });
      await banner({ title: 'To hidden cat', imageMediaId, actionType: 'OPEN_CATEGORY', actionValue: hiddenCat, isActive: true });
      await banner({ title: 'To category', imageMediaId, actionType: 'OPEN_CATEGORY', actionValue: nature, isActive: true });

      await section({ title: 'Banners', sectionType: 'BANNERS' });
      await section({ title: 'Featured', sectionType: 'FEATURED_WALLPAPERS' });
      await section({ title: 'Nature', sectionType: 'CATEGORY_WALLPAPERS', configuration: { categoryId: nature, sort: 'latest' } });
      await section({ title: 'Hidden cat', sectionType: 'CATEGORY_WALLPAPERS', configuration: { categoryId: hiddenCat } });
      await section({ title: 'Picks', sectionType: 'CUSTOM_WALLPAPERS', configuration: { wallpaperIds: [w2, draft, w1] } });
      await section({ title: 'Categories', sectionType: 'CATEGORIES' });
      await section({ title: 'Disabled', sectionType: 'LATEST_WALLPAPERS', isEnabled: false });
      await section({ title: 'Landscape only', sectionType: 'LATEST_WALLPAPERS', configuration: { orientation: 'LANDSCAPE' } });

      const sections = await home();
      expect(sections.map((s) => s.title)).toEqual(['Banners', 'Featured', 'Nature', 'Picks', 'Categories']);

      const [banners, featured, natureSec, picks, cats] = sections;
      expect(banners.items.map((b) => (b as unknown as { title: string }).title)).toEqual(['To wallpaper', 'To category']);
      expect(banners.items[1].action).toEqual({ type: 'OPEN_CATEGORY', categoryId: nature, categorySlug: 'nature' });
      expect(featured.items.map((w) => w.id)).toEqual([w1]);
      expect(natureSec.category?.id).toBe(nature);
      expect(natureSec.items.map((w) => w.id).sort()).toEqual([w1, w2].sort());
      expect(picks.items.map((w) => w.id)).toEqual([w2, w1]);
      expect(cats.items.map((c) => c.id)).toEqual([nature]);

      const serialized = JSON.stringify(sections);
      expect(serialized).not.toContain(draft);
      expect(serialized).not.toContain(hiddenCat);
    });

    it('respects limits, banner settings and exposes the layout in app-config', async () => {
      for (let i = 0; i < 4; i++) await wallpaper({ title: `W${i}`, isPublished: true });
      const imageMediaId = await uploadMedia(ctx, session, 800, 400);
      await banner({ title: 'B', imageMediaId, actionType: 'NONE', isActive: true });
      const latest = (await section({ title: 'Latest', sectionType: 'LATEST_WALLPAPERS', configuration: { limit: 2 } })).body.data.id;
      const latest3 = (await section({ title: 'Latest 3', sectionType: 'LATEST_WALLPAPERS', configuration: { limit: 3 } })).body.data.id;
      await section({ title: 'Banners', sectionType: 'BANNERS' });

      let sections = await home();
      expect(sections.find((s) => s.id === latest)!.items).toHaveLength(2);
      expect(sections.find((s) => s.id === latest3)!.items).toHaveLength(3);
      expect(sections.map((s) => s.title)).toContain('Banners');

      const superAdmin = await adminSession(ctx, 'SUPER_ADMIN');
      await ctx.http().patch(`${API}/admin/settings`).set(superAdmin.auth).send({ home: { bannersEnabled: false } }).expect(200);
      sections = await home();
      expect(sections.map((s) => s.title)).not.toContain('Banners');

      const config = await ctx.http().get(`${API}/public/app-config`).expect(200);
      expect(config.body.data.home.layout.map((l: { title: string }) => l.title)).toEqual(['Latest', 'Latest 3', 'Banners']);
      expect(Object.keys(config.body.data.home.layout[0]).sort()).toEqual(['id', 'title', 'type']);
    });
  });
});
