import { existsSync } from 'node:fs';
import { config } from 'dotenv';

process.env.NODE_ENV = 'test';
if (!existsSync('.env.test')) {
  throw new Error('Missing .env.test - copy .env.test.example and point DATABASE_URL at a disposable database');
}
config({ path: '.env.test', override: true, quiet: true });
