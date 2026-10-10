import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AdminRole } from '../../src/generated/prisma/client';
import { hashPassword } from '../../src/modules/auth/password.util';
import { STORAGE_PROVIDER } from '../../src/modules/media/storage/storage-provider.interface';
import { PrismaService } from '../../src/prisma/prisma.service';
import { makeJpeg } from './images';
import { InMemoryStorageProvider } from './in-memory-storage';

export const API = '/api/v1';
export const TEST_PASSWORD = 'Test-Passw0rd-123!';

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  storage: InMemoryStorageProvider;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  const storage = new InMemoryStorageProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STORAGE_PROVIDER)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, storage, http: () => request(app.getHttpServer()) };
}

const TABLES = [
  'wallpaper_daily_stats',
  'wallpaper_events',
  'wallpaper_categories',
  'wallpapers',
  'banners',
  'categories',
  'home_sections',
  'app_settings',
  'media_assets',
  'audit_logs',
  'refresh_tokens',
  'admins',
];

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let adminPasswordHash: string | null = null;

export async function createAdmin(
  prisma: PrismaService,
  overrides: { email?: string; role?: AdminRole; isActive?: boolean; name?: string } = {},
) {
  adminPasswordHash ??= await hashPassword(TEST_PASSWORD);
  return prisma.admin.create({
    data: {
      email: overrides.email ?? `admin-${Math.random().toString(36).slice(2, 10)}@test.local`,
      name: overrides.name ?? 'Test Admin',
      role: overrides.role ?? 'SUPER_ADMIN',
      isActive: overrides.isActive ?? true,
      passwordHash: adminPasswordHash,
    },
  });
}

export interface LoggedIn {
  accessToken: string;
  csrfToken: string;
  cookies: string[];
  auth: { Authorization: string };
}

export async function login(ctx: TestContext, email: string, password = TEST_PASSWORD): Promise<LoggedIn> {
  const res = await ctx.http().post(`${API}/admin/auth/login`).send({ email, password }).expect(200);
  const body = res.body as { data: { accessToken: string; csrfToken: string } };
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  return {
    accessToken: body.data.accessToken,
    csrfToken: body.data.csrfToken,
    cookies: (setCookie ?? []).map((c) => c.split(';')[0]),
    auth: { Authorization: `Bearer ${body.data.accessToken}` },
  };
}

/** Uploads a generated JPEG through the API and returns the media id. */
export async function uploadMedia(ctx: TestContext, session: LoggedIn, width = 400, height = 800): Promise<string> {
  const res = await ctx
    .http()
    .post(`${API}/admin/media`)
    .set(session.auth)
    .attach('file', await makeJpeg(width, height), { filename: 'img.jpg', contentType: 'image/jpeg' })
    .expect(201);
  return (res.body as { data: { id: string } }).data.id;
}

/** Creates an admin with the given role and logs in. */
export async function adminSession(ctx: TestContext, role: AdminRole = 'SUPER_ADMIN'): Promise<LoggedIn & { id: string }> {
  const admin = await createAdmin(ctx.prisma, { role });
  return { ...(await login(ctx, admin.email)), id: admin.id };
}
