/**
 * Idempotent seed:
 *  - creates the initial SUPER_ADMIN from SEED_ADMIN_* environment variables (never hardcoded);
 *    an existing admin with the same email is left untouched (password is NOT reset),
 *  - creates default app settings and default home sections when none exist.
 *
 * Usage: npm run db:seed   (or `node dist/prisma/seed.js` inside the production image)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { HomeSectionType, Prisma, PrismaClient } from '../src/generated/prisma/client';
import { APP_CONFIG_KEY, buildDefaultAppSettings } from '../src/modules/app-settings/app-settings.defaults';
import { hashPassword, validatePasswordStrength } from '../src/modules/auth/password.util';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await seedAdmin(prisma);
    await seedSettings(prisma);
    await seedHomeSections(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function seedAdmin(prisma: PrismaClient): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Super Admin';

  if (!email || !password) {
    console.log('[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set - skipping admin creation');
    return;
  }
  const passwordProblem = validatePasswordStrength(password);
  if (passwordProblem) throw new Error(`[seed] SEED_ADMIN_PASSWORD rejected: ${passwordProblem}`);

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] Admin ${email} already exists - leaving unchanged`);
    return;
  }
  await prisma.admin.create({
    data: {
      email,
      name,
      role: 'SUPER_ADMIN',
      passwordHash: await hashPassword(password),
    },
  });
  console.log(`[seed] Created SUPER_ADMIN ${email}`);
}

async function seedSettings(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.appSetting.findUnique({ where: { key: APP_CONFIG_KEY } });
  if (existing) return;
  await prisma.appSetting.create({
    data: {
      key: APP_CONFIG_KEY,
      value: buildDefaultAppSettings() as unknown as Prisma.InputJsonValue,
    },
  });
  console.log('[seed] Created default app settings');
}

async function seedHomeSections(prisma: PrismaClient): Promise<void> {
  if ((await prisma.homeSection.count()) > 0) return;
  const defaults: { title: string; sectionType: HomeSectionType; configuration: Prisma.InputJsonValue }[] = [
    { title: 'Highlights', sectionType: 'BANNERS', configuration: {} },
    { title: 'Featured', sectionType: 'FEATURED_WALLPAPERS', configuration: { limit: 10 } },
    { title: 'Categories', sectionType: 'CATEGORIES', configuration: { limit: 12 } },
    { title: 'Popular', sectionType: 'POPULAR_WALLPAPERS', configuration: { limit: 10 } },
    { title: 'Newest', sectionType: 'LATEST_WALLPAPERS', configuration: { limit: 10 } },
  ];
  await prisma.homeSection.createMany({
    data: defaults.map((d, i) => ({ ...d, sortOrder: i, isEnabled: true })),
  });
  console.log('[seed] Created default home sections');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
