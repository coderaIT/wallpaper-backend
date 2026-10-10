import { adminSession, API, createTestApp, LoggedIn, resetDatabase, TestContext } from './utils/test-app';

describe('App settings & remote config (e2e)', () => {
  let ctx: TestContext;
  let superAdmin: LoggedIn & { id: string };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    superAdmin = await adminSession(ctx, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const patch = (body: unknown, status: number) =>
    ctx.http().patch(`${API}/admin/settings`).set(superAdmin.auth).send(body as object).expect(status);

  it('returns complete defaults and requires authentication', async () => {
    await ctx.http().get(`${API}/admin/settings`).expect(401);
    const res = await ctx.http().get(`${API}/admin/settings`).set(superAdmin.auth).expect(200);
    expect(res.body.data.version).toBe(0);
    expect(res.body.data.settings).toMatchObject({
      maintenance: { enabled: false },
      downloads: { enabled: true, allowOriginalDownload: true },
      home: { bannersEnabled: true },
      featureFlags: {},
    });
  });

  it('only SUPER_ADMIN can update; editors can read', async () => {
    const editor = await adminSession(ctx, 'EDITOR');
    await ctx.http().get(`${API}/admin/settings`).set(editor.auth).expect(200);
    await ctx.http().patch(`${API}/admin/settings`).set(editor.auth).send({ maintenance: { enabled: true } }).expect(403);
  });

  it('deep-merges partial updates, bumps version and audits the change', async () => {
    const res = await patch({ expectedVersion: undefined, maintenance: { enabled: true, message: 'Back soon' } }, 200);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.settings.maintenance).toMatchObject({ enabled: true, message: 'Back soon' });
    expect(res.body.data.settings.maintenance.title).toBeTruthy();
    expect(res.body.data.updatedBy).toMatchObject({ id: superAdmin.id });

    const res2 = await patch({ expectedVersion: 1, featureFlags: { newSearch: true } }, 200);
    expect(res2.body.data.version).toBe(2);
    expect(res2.body.data.settings.maintenance.enabled).toBe(true);

    const logs = await ctx.prisma.auditLog.findMany({ where: { action: 'SETTINGS_UPDATED' } });
    expect(logs).toHaveLength(2);
  });

  it('rejects stale versions with 409', async () => {
    await patch({ maintenance: { enabled: true } }, 200);
    const res = await patch({ expectedVersion: 5, maintenance: { enabled: false } }, 409);
    expect(res.body.details).toEqual({ expectedVersion: 5, currentVersion: 1 });
  });

  it('validates the merged document and rejects unknown keys', async () => {
    await patch({ maintenance: { enabled: 'yes' } }, 400);
    await patch({ maintenance: { unknownKey: 1 } }, 400);
    await patch({ notAGroup: {} }, 400);
    await patch({ appUpdate: { android: { minSupportedVersion: 'latest' } } }, 400);
    await patch({ appUpdate: { android: { minSupportedVersion: '3.0.0', latestVersion: '2.0.0' } } }, 400);
    await patch({ featureFlags: { a: 'true' } }, 400);
    await patch({ home: { defaultSectionLimit: 500 } }, 400);
    await patch({ externalLinks: { privacyPolicyUrl: 'javascript:alert(1)' } }, 400);
    await patch({ externalLinks: { websiteUrl: 'http://127.0.0.1/admin' } }, 400);
    const res = await patch({ announcements: [{ id: 'x', title: 'T' }] }, 400);
    expect(Array.isArray(res.body.details)).toBe(true);

    const current = await ctx.http().get(`${API}/admin/settings`).set(superAdmin.auth).expect(200);
    expect(current.body.data.version).toBe(0);
  });

  it('is not vulnerable to prototype pollution', async () => {
    const payload = '{"maintenance":{"__proto__":{"polluted":true},"enabled":true},"featureFlags":{"constructor":{"prototype":{"polluted":true}}}}';
    await ctx
      .http()
      .patch(`${API}/admin/settings`)
      .set(superAdmin.auth)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect((r) => expect([200, 400]).toContain(r.status));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const row = await ctx.prisma.appSetting.findUnique({ where: { key: 'app_config' } });
    if (row) expect(JSON.stringify(row.value)).not.toContain('polluted');
  });

  it('serves allowlisted public config with computed update status', async () => {
    await patch(
      {
        appUpdate: { android: { minSupportedVersion: '2.0.0', latestVersion: '2.1.0', storeUrl: 'https://play.google.com/store/apps/details?id=x' } },
        announcements: [
          { id: 'now', title: 'Live', message: 'Visible', level: 'INFO', actionUrl: null, dismissible: true, isActive: true, startsAt: null, endsAt: null },
          { id: 'off', title: 'Off', message: 'Hidden', level: 'INFO', actionUrl: null, dismissible: true, isActive: false, startsAt: null, endsAt: null },
          { id: 'future', title: 'Later', message: 'Hidden', level: 'INFO', actionUrl: null, dismissible: true, isActive: true, startsAt: '2999-01-01T00:00:00.000Z', endsAt: null },
        ],
      },
      200,
    );

    const status = async (v: string) =>
      (await ctx.http().get(`${API}/public/app-config?platform=ANDROID&appVersion=${v}`).expect(200)).body.data.update.status;
    expect(await status('1.9.9')).toBe('REQUIRED');
    expect(await status('2.0.5')).toBe('AVAILABLE');
    expect(await status('2.1.0')).toBe('NONE');
    expect(await status('10.0.0')).toBe('NONE');

    const res = await ctx.http().get(`${API}/public/app-config`).expect(200);
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['maintenance', 'update', 'announcements', 'downloads', 'home', 'links', 'features', 'serverTime'].sort(),
    );
    expect(res.body.data.update.status).toBeUndefined();
    expect(res.body.data.announcements.map((a: { id: string }) => a.id)).toEqual(['now']);
    expect(res.body.data.update.android.storeUrl).toContain('play.google.com');

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(process.env.JWT_ACCESS_SECRET!);
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toMatch(/updatedBy|version"/);

    await ctx.http().get(`${API}/public/app-config?appVersion=1.2`).expect(400);
    await ctx.http().get(`${API}/public/app-config?platform=WINDOWS`).expect(400);
  });
});
