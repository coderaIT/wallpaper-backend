import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

/** Applies migrations to the dedicated test database once per test run. */
export default function globalSetup(): void {
  if (!existsSync('.env.test')) {
    throw new Error('Missing .env.test - copy .env.test.example and point DATABASE_URL at a disposable database');
  }
  const env = config({ path: '.env.test', override: false, quiet: true }).parsed ?? {};
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl || !/test/i.test(new URL(databaseUrl).pathname)) {
    throw new Error('Refusing to run e2e tests: DATABASE_URL in .env.test must point to a database whose name contains "test"');
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
  });
}
