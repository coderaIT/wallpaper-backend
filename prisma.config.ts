import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL is only required by commands that talk to the database (migrate, seed).
// `prisma generate` works without it, which keeps Docker builds and CI installs simple.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
