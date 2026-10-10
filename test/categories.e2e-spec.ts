import { adminSession, API, createTestApp, LoggedIn, resetDatabase, TestContext, uploadMedia } from './utils/test-app';

describe('Category management (e2e)', () => {
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

  const create = (body: Record<string, unknown>) => ctx.http().post(`${API}/admin/categories`).set(session.auth).send(body);

  it('creates a category with a generated unique slug', async () => {
    const a = await create({ name: 'Ocean Waves' }).expect(201);
    expect(a.body.data).toMatchObject({ name: 'Ocean Waves', slug: 'ocean-waves', isPublished: false, sortOrder: 0, wallpaperCount: 0, cover: null });
    const b = await create({ name: 'Ocean  Waves!' }).expect(201);
    expect(b.body.data.slug).toBe('ocean-waves-2');
    expect(b.body.data.sortOrder).toBe(1);
  });

  it('rejects duplicate explicit slugs and invalid input', async () => {
    await create({ name: 'Space', slug: 'space' }).expect(201);
    await create({ name: 'Space 2', slug: 'space' }).expect(409);
    await create({ name: 'Bad', slug: 'Not A Slug' }).expect(400);
    await create({ name: '' }).expect(400);
    await create({ name: 'x', unknownField: true }).expect(400);
    await create({ name: 'x', coverMediaId: '00000000-0000-4000-8000-000000000000' }).expect(404);
  });

  it('reads, updates, publishes and sets the cover', async () => {
    const { body } = await create({ name: 'Cars' }).expect(201);
    const id = body.data.id as string;

    await ctx.http().get(`${API}/admin/categories/${id}`).set(session.auth).expect(200);
    const updated = await ctx
      .http()
      .patch(`${API}/admin/categories/${id}`)
      .set(session.auth)
      .send({ name: 'Fast Cars', description: 'Vroom', isPublished: true })
      .expect(200);
    expect(updated.body.data).toMatchObject({ name: 'Fast Cars', description: 'Vroom', isPublished: true, slug: 'cars' });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'CATEGORY_PUBLISHED', entityId: id } })).toBe(1);

    const mediaId = await uploadMedia(ctx, session);
    const withCover = await ctx.http().patch(`${API}/admin/categories/${id}/cover`).set(session.auth).send({ mediaId }).expect(200);
    expect(withCover.body.data.cover.mediaId).toBe(mediaId);
    expect(withCover.body.data.cover.thumbnailUrl).toContain('thumbnail.webp');
    const noCover = await ctx.http().patch(`${API}/admin/categories/${id}/cover`).set(session.auth).send({ mediaId: null }).expect(200);
    expect(noCover.body.data.cover).toBeNull();
  });

  it('lists with pagination, search and filters', async () => {
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) await create({ name, isPublished: name !== 'Delta' }).expect(201);
    const page = await ctx.http().get(`${API}/admin/categories?page=2&limit=3`).set(session.auth).expect(200);
    expect(page.body.meta).toEqual({ page: 2, limit: 3, total: 4, totalPages: 2 });
    expect(page.body.data).toHaveLength(1);

    const search = await ctx.http().get(`${API}/admin/categories?search=amm`).set(session.auth).expect(200);
    expect(search.body.data.map((c: { name: string }) => c.name)).toEqual(['Gamma']);

    const drafts = await ctx.http().get(`${API}/admin/categories?isPublished=false`).set(session.auth).expect(200);
    expect(drafts.body.data.map((c: { name: string }) => c.name)).toEqual(['Delta']);

    await ctx.http().get(`${API}/admin/categories?sortBy=passwordHash`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/categories?sortDir=sideways`).set(session.auth).expect(400);
  });

  it('reorders categories', async () => {
    const a = (await create({ name: 'A' })).body.data.id;
    const b = (await create({ name: 'B' })).body.data.id;
    await ctx
      .http()
      .patch(`${API}/admin/categories/reorder`)
      .set(session.auth)
      .send({ items: [{ id: a, sortOrder: 5 }, { id: b, sortOrder: 1 }] })
      .expect(200);
    const list = await ctx.http().get(`${API}/admin/categories`).set(session.auth).expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([b, a]);

    await ctx.http().patch(`${API}/admin/categories/reorder`).set(session.auth).send({ items: [{ id: a, sortOrder: 1 }, { id: a, sortOrder: 2 }] }).expect(400);
    await ctx
      .http()
      .patch(`${API}/admin/categories/reorder`)
      .set(session.auth)
      .send({ items: [{ id: '00000000-0000-4000-8000-000000000000', sortOrder: 1 }] })
      .expect(404);
  });

  it('deletes a category and returns 404 for invalid/missing ids', async () => {
    const id = (await create({ name: 'Temp' })).body.data.id;
    await ctx.http().delete(`${API}/admin/categories/${id}`).set(session.auth).expect(204);
    await ctx.http().get(`${API}/admin/categories/${id}`).set(session.auth).expect(404);
    await ctx.http().delete(`${API}/admin/categories/not-a-uuid`).set(session.auth).expect(400);
  });

  it('requires authentication', async () => {
    await ctx.http().get(`${API}/admin/categories`).expect(401);
    await ctx.http().post(`${API}/admin/categories`).send({ name: 'x' }).expect(401);
  });
});
