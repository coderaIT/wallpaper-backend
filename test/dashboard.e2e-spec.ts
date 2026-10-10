import {
  adminSession,
  API,
  createTestApp,
  LoggedIn,
  login,
  resetDatabase,
  TestContext,
  TEST_PASSWORD,
  uploadMedia,
} from './utils/test-app';

describe('Dashboard & audit logs (e2e)', () => {
  let ctx: TestContext;
  let editor: LoggedIn;
  let superAdmin: LoggedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.storage.reset();
    editor = await adminSession(ctx, 'EDITOR');
    superAdmin = await adminSession(ctx, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const wallpaper = async (body: Record<string, unknown>) => {
    const mediaId = await uploadMedia(ctx, editor);
    return (
      await ctx
        .http()
        .post(`${API}/admin/wallpapers`)
        .set(editor.auth)
        .send({ mediaId, ...body })
        .expect(201)
    ).body.data.id as string;
  };

  it('summarizes content and analytics', async () => {
    await wallpaper({ title: 'A', isPublished: true, isFeatured: true });
    await wallpaper({ title: 'B', isPublished: false });
    await ctx
      .http()
      .post(`${API}/admin/categories`)
      .set(editor.auth)
      .send({ name: 'Nature', isPublished: true })
      .expect(201);
    await ctx
      .http()
      .post(`${API}/admin/categories`)
      .set(editor.auth)
      .send({ name: 'Draft' })
      .expect(201);

    await ctx.http().get(`${API}/admin/dashboard/overview`).expect(401);
    const res = await ctx
      .http()
      .get(`${API}/admin/dashboard/overview`)
      .set(editor.auth)
      .expect(200);
    expect(res.body.data.content).toEqual({
      wallpapers: { total: 2, published: 1, unpublished: 1, featured: 1 },
      categories: { total: 2, published: 1 },
      banners: { total: 0, activeNow: 0 },
      mediaOriginals: 2,
    });
    expect(res.body.data.analytics.today).toEqual({ views: 0, downloadClicks: 0, downloads: 0 });
    expect(res.body.data.topWallpapersLast7Days).toEqual([]);
  });

  it('lists recent wallpapers and storage usage', async () => {
    await wallpaper({ title: 'Old' });
    await wallpaper({ title: 'New' });
    const recent = await ctx
      .http()
      .get(`${API}/admin/dashboard/recent-wallpapers?limit=1`)
      .set(editor.auth)
      .expect(200);
    expect(recent.body.data).toHaveLength(1);
    expect(recent.body.data[0]).toMatchObject({ title: 'New', isPublished: false });
    expect(recent.body.data[0].thumbnailUrl).toMatch(/thumbnail\.webp$/);
    await ctx
      .http()
      .get(`${API}/admin/dashboard/recent-wallpapers?limit=abc`)
      .set(editor.auth)
      .expect(400);

    const storage = await ctx
      .http()
      .get(`${API}/admin/dashboard/storage`)
      .set(editor.auth)
      .expect(200);
    expect(storage.body.data.variants.ORIGINAL.count).toBe(2);
    expect(storage.body.data.variants.THUMBNAIL.count).toBe(2);
    expect(storage.body.data.totalBytes).toBeGreaterThan(0);
    expect(storage.body.data.unusedOriginals).toBe(0);
  });

  it('restricts activity and audit logs to SUPER_ADMIN and never leaks secrets', async () => {
    await wallpaper({ title: 'Audited', isPublished: true });
    await ctx
      .http()
      .post(`${API}/admin/auth/change-password`)
      .set(superAdmin.auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Another-Passw0rd-456!' })
      .expect(204);
    // Password changes invalidate outstanding access tokens.
    await ctx.http().get(`${API}/admin/dashboard/recent-activity`).set(superAdmin.auth).expect(401);
    const superEmail = (await ctx.prisma.admin.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } }))
      .email;
    superAdmin = await login(ctx, superEmail, 'Another-Passw0rd-456!');

    await ctx.http().get(`${API}/admin/dashboard/recent-activity`).set(editor.auth).expect(403);
    await ctx.http().get(`${API}/admin/audit-logs`).set(editor.auth).expect(403);

    const activity = await ctx
      .http()
      .get(`${API}/admin/dashboard/recent-activity?limit=50`)
      .set(superAdmin.auth)
      .expect(200);
    const actions = activity.body.data.map((a: { action: string }) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'WALLPAPER_CREATED',
        'AUTH_PASSWORD_CHANGED',
        'MEDIA_UPLOADED',
        'AUTH_LOGIN',
      ]),
    );

    const logs = await ctx
      .http()
      .get(`${API}/admin/audit-logs?limit=100`)
      .set(superAdmin.auth)
      .expect(200);
    const serialized = JSON.stringify([activity.body, logs.body]);
    for (const secret of [
      TEST_PASSWORD,
      'Another-Passw0rd-456!',
      superAdmin.accessToken,
      'passwordHash',
      '$argon2',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    const filtered = await ctx
      .http()
      .get(`${API}/admin/audit-logs?action=WALLPAPER_CREATED`)
      .set(superAdmin.auth)
      .expect(200);
    expect(filtered.body.meta.total).toBe(1);
    expect(filtered.body.data[0].admin).toMatchObject({ name: 'Test Admin' });
  });
});
