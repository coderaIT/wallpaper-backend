import {
  API,
  adminSession,
  createAdmin,
  createTestApp,
  login,
  resetDatabase,
  TestContext,
  TEST_PASSWORD,
} from './utils/test-app';

describe('Admin authentication & authorization (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('POST /admin/auth/login', () => {
    it('logs in with valid credentials and sets secure cookies', async () => {
      const admin = await createAdmin(ctx.prisma, { email: 'boss@test.local' });
      const res = await ctx
        .http()
        .post(`${API}/admin/auth/login`)
        .send({ email: 'Boss@Test.local', password: TEST_PASSWORD })
        .expect(200);

      expect(res.body.data).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
        admin: { id: admin.id, email: 'boss@test.local', role: 'SUPER_ADMIN' },
      });
      expect(typeof res.body.data.accessToken).toBe('string');
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(res.headers['cache-control']).toBe('no-store');

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const refresh = cookies.find((c) => c.startsWith('refresh_token='));
      expect(refresh).toBeDefined();
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/api/v1/admin/auth');
      expect(refresh).toContain('SameSite=Strict');
      expect(cookies.some((c) => c.startsWith('csrf_token='))).toBe(true);

      // Only the hash of the refresh token is stored
      const raw = refresh!.split(';')[0].split('=')[1];
      const stored = await ctx.prisma.refreshToken.findFirst({ where: { adminId: admin.id } });
      expect(stored?.tokenHash).toHaveLength(64);
      expect(stored?.tokenHash).not.toEqual(raw);
      expect(raw).not.toContain(stored!.tokenHash);

      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'AUTH_LOGIN' } });
      expect(audit?.adminId).toBe(admin.id);
    });

    it('rejects invalid password with a generic 401', async () => {
      const admin = await createAdmin(ctx.prisma);
      const res = await ctx
        .http()
        .post(`${API}/admin/auth/login`)
        .send({ email: admin.email, password: 'Wrong-Passw0rd!' })
        .expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects unknown email with the same generic 401', async () => {
      const res = await ctx
        .http()
        .post(`${API}/admin/auth/login`)
        .send({ email: 'nobody@test.local', password: TEST_PASSWORD })
        .expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('validates the request body', async () => {
      const res = await ctx
        .http()
        .post(`${API}/admin/auth/login`)
        .send({ email: 'not-an-email', password: '', extra: 1 })
        .expect(400);
      expect(res.body.message).toBe('Validation failed');
      expect(Array.isArray(res.body.details)).toBe(true);
    });

    it('locks the account after repeated failures', async () => {
      const admin = await createAdmin(ctx.prisma);
      for (let i = 0; i < 5; i++) {
        await ctx
          .http()
          .post(`${API}/admin/auth/login`)
          .send({ email: admin.email, password: 'Wrong-Passw0rd!' })
          .expect(401);
      }
      await ctx
        .http()
        .post(`${API}/admin/auth/login`)
        .send({ email: admin.email, password: TEST_PASSWORD })
        .expect(401);
      const locked = await ctx.prisma.admin.findUniqueOrThrow({ where: { id: admin.id } });
      expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects disabled admins', async () => {
      const admin = await createAdmin(ctx.prisma, { isActive: false });
      await ctx
        .http()
        .post(`${API}/admin/auth/login`)
        .send({ email: admin.email, password: TEST_PASSWORD })
        .expect(403);
    });
  });

  describe('protected endpoints', () => {
    it('requires a bearer token', async () => {
      await ctx.http().get(`${API}/admin/auth/me`).expect(401);
      await ctx.http().get(`${API}/admin/admins`).expect(401);
      await ctx
        .http()
        .get(`${API}/admin/auth/me`)
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });

    it('returns the profile for a valid token', async () => {
      const session = await adminSession(ctx);
      const res = await ctx.http().get(`${API}/admin/auth/me`).set(session.auth).expect(200);
      expect(res.body.data.id).toBe(session.id);
      expect(res.body.data.passwordHash).toBeUndefined();
    });

    it('blocks an admin that is disabled after login', async () => {
      const session = await adminSession(ctx);
      await ctx.prisma.admin.update({ where: { id: session.id }, data: { isActive: false } });
      await ctx.http().get(`${API}/admin/auth/me`).set(session.auth).expect(403);
    });

    it('invalidates outstanding access tokens on password change and reset', async () => {
      const session = await adminSession(ctx);
      const other = await login(
        ctx,
        (await ctx.prisma.admin.findUniqueOrThrow({ where: { id: session.id } })).email,
      );
      await ctx
        .http()
        .post(`${API}/admin/auth/change-password`)
        .set(session.auth)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'Brand-New-Passw0rd!' })
        .expect(204);
      await ctx.http().get(`${API}/admin/auth/me`).set(session.auth).expect(401);
      await ctx.http().get(`${API}/admin/auth/me`).set(other.auth).expect(401);
      const fresh = await login(
        ctx,
        (await ctx.prisma.admin.findUniqueOrThrow({ where: { id: session.id } })).email,
        'Brand-New-Passw0rd!',
      );
      await ctx.http().get(`${API}/admin/auth/me`).set(fresh.auth).expect(200);

      const editor = await adminSession(ctx, 'EDITOR');
      await ctx
        .http()
        .patch(`${API}/admin/admins/${editor.id}/password`)
        .set(fresh.auth)
        .send({ newPassword: 'Reset-By-Admin-123!' })
        .expect(204);
      await ctx.http().get(`${API}/admin/auth/me`).set(editor.auth).expect(401);
      await ctx.http().get(`${API}/admin/auth/me`).set(fresh.auth).expect(200);
    });
  });

  describe('role-based access', () => {
    it('forbids EDITOR from SUPER_ADMIN-only endpoints', async () => {
      const editor = await adminSession(ctx, 'EDITOR');
      await ctx.http().get(`${API}/admin/admins`).set(editor.auth).expect(403);
      await ctx.http().get(`${API}/admin/audit-logs`).set(editor.auth).expect(403);
    });

    it('allows SUPER_ADMIN to manage admins', async () => {
      const boss = await adminSession(ctx);
      const created = await ctx
        .http()
        .post(`${API}/admin/admins`)
        .set(boss.auth)
        .send({
          name: 'New Editor',
          email: 'editor@test.local',
          password: 'An0ther-Str0ng-Pass',
          role: 'EDITOR',
        })
        .expect(201);
      expect(created.body.data).toMatchObject({
        email: 'editor@test.local',
        role: 'EDITOR',
        isActive: true,
      });
      expect(created.body.data.passwordHash).toBeUndefined();

      await ctx
        .http()
        .patch(`${API}/admin/admins/${created.body.data.id}`)
        .set(boss.auth)
        .send({ isActive: false })
        .expect(200);
      await ctx
        .http()
        .patch(`${API}/admin/admins/${boss.id}`)
        .set(boss.auth)
        .send({ isActive: false })
        .expect(400);
      await ctx.http().get(`${API}/admin/admins/not-a-uuid`).set(boss.auth).expect(400);
    });

    it('rejects weak passwords for new admins', async () => {
      const boss = await adminSession(ctx);
      await ctx
        .http()
        .post(`${API}/admin/admins`)
        .set(boss.auth)
        .send({ name: 'Weak', email: 'weak@test.local', password: 'aaaaaaaaaaaa', role: 'EDITOR' })
        .expect(400);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the refresh token and requires CSRF', async () => {
      const admin = await createAdmin(ctx.prisma);
      const session = await login(ctx, admin.email);

      await ctx.http().post(`${API}/admin/auth/refresh`).set('Cookie', session.cookies).expect(403);
      await ctx
        .http()
        .post(`${API}/admin/auth/refresh`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', 'forged')
        .expect(403);

      const res = await ctx
        .http()
        .post(`${API}/admin/auth/refresh`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrfToken)
        .expect(200);
      expect(res.body.data.accessToken).toBeDefined();
      const newCookies = (res.headers['set-cookie'] as unknown as string[]).map(
        (c) => c.split(';')[0],
      );
      const newRefresh = newCookies.find((c) => c.startsWith('refresh_token='));
      expect(newRefresh).not.toEqual(session.cookies.find((c) => c.startsWith('refresh_token=')));

      const tokens = await ctx.prisma.refreshToken.findMany({
        where: { adminId: admin.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(tokens).toHaveLength(2);
      expect(tokens[0].revokedReason).toBe('ROTATED');
      expect(tokens[0].replacedById).toBe(tokens[1].id);
    });

    it('revokes the whole family when a rotated token is reused after the grace window', async () => {
      const admin = await createAdmin(ctx.prisma);
      const session = await login(ctx, admin.email);
      const rotated = await ctx
        .http()
        .post(`${API}/admin/auth/refresh`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrfToken)
        .expect(200);
      // Simulate the old token being replayed later (outside the concurrency grace window)
      await ctx.prisma.refreshToken.updateMany({
        where: { adminId: admin.id, revokedReason: 'ROTATED' },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });
      await ctx
        .http()
        .post(`${API}/admin/auth/refresh`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrfToken)
        .expect(401);

      const active = await ctx.prisma.refreshToken.count({
        where: { adminId: admin.id, revokedAt: null },
      });
      expect(active).toBe(0);
      const newCookies = (rotated.headers['set-cookie'] as unknown as string[]).map(
        (c) => c.split(';')[0],
      );
      await ctx
        .http()
        .post(`${API}/admin/auth/refresh`)
        .set('Cookie', newCookies)
        .set('X-CSRF-Token', rotated.body.data.csrfToken)
        .expect(401);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'AUTH_REFRESH_TOKEN_REUSE' } }),
      ).toBe(1);
    });

    it('logout revokes the session', async () => {
      const admin = await createAdmin(ctx.prisma);
      const session = await login(ctx, admin.email);
      await ctx
        .http()
        .post(`${API}/admin/auth/logout`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrfToken)
        .expect(204);
      await ctx
        .http()
        .post(`${API}/admin/auth/refresh`)
        .set('Cookie', session.cookies)
        .set('X-CSRF-Token', session.csrfToken)
        .expect(401);
    });

    it('never stores secrets in audit logs', async () => {
      const admin = await createAdmin(ctx.prisma);
      await login(ctx, admin.email);
      await ctx
        .http()
        .post(`${API}/admin/auth/login`)
        .send({ email: admin.email, password: 'Wrong-Passw0rd!' })
        .expect(401);
      const logs = await ctx.prisma.auditLog.findMany();
      const serialized = JSON.stringify(logs);
      expect(serialized).not.toContain(TEST_PASSWORD);
      expect(serialized).not.toContain('Wrong-Passw0rd!');
    });
  });
});
