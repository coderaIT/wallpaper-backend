import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom, of } from 'rxjs';
import { EnvironmentVariables } from '../../config/env.validation';
import { PublicCacheInterceptor } from './public-cache.interceptor';

function run(ttl: number, method = 'GET', statusCode = 200) {
  const headers = new Map<string, string>();
  const res = {
    statusCode,
    getHeader: (k: string) => headers.get(k),
    setHeader: (k: string, v: string) => headers.set(k, v),
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ method }), getResponse: () => res }),
  } as unknown as ExecutionContext;
  const config = { get: () => ttl } as unknown as ConfigService<EnvironmentVariables, true>;
  const next: CallHandler = { handle: () => of({ ok: true }) };
  return lastValueFrom(new PublicCacheInterceptor(config).intercept(ctx, next)).then(() => headers.get('Cache-Control'));
}

describe('PublicCacheInterceptor', () => {
  it('sets shared-cache headers when a TTL is configured', async () => {
    expect(await run(30)).toBe('public, max-age=30, stale-while-revalidate=60');
  });

  it('uses no-cache when caching is disabled', async () => {
    expect(await run(0)).toBe('no-cache');
  });

  it('leaves non-GET and non-200 responses untouched', async () => {
    expect(await run(30, 'POST')).toBeUndefined();
    expect(await run(30, 'GET', 201)).toBeUndefined();
  });
});
