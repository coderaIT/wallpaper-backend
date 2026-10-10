import { buildOpenApiDocument } from '../src/swagger';
import { createTestApp, TestContext } from './utils/test-app';

type Operation = { summary?: string; tags?: string[]; security?: Record<string, string[]>[] };
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
/** Auth endpoints that are reachable without an access token (they use credentials or the refresh cookie). */
const UNAUTHENTICATED_ADMIN = new Set([
  'post /api/v1/admin/auth/login',
  'post /api/v1/admin/auth/refresh',
  'get /api/v1/admin/auth/csrf',
  'post /api/v1/admin/auth/logout',
]);

describe('OpenAPI document & deny-by-default routing (e2e)', () => {
  let ctx: TestContext;
  let operations: { method: (typeof METHODS)[number]; path: string; op: Operation }[];

  beforeAll(async () => {
    ctx = await createTestApp();
    const doc = buildOpenApiDocument(ctx.app);
    operations = Object.entries(doc.paths).flatMap(([path, item]) =>
      METHODS.filter((m) => (item as Record<string, unknown>)[m]).map((method) => ({
        method,
        path,
        op: (item as Record<string, Operation>)[method],
      })),
    );
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('documents every operation with a summary and tag', () => {
    expect(operations.length).toBeGreaterThan(60);
    const missing = operations
      .filter(({ op }) => !op.summary || !op.tags?.length)
      .map(({ method, path }) => `${method} ${path}`);
    expect(missing).toEqual([]);
  });

  it('marks admin operations as bearer-protected and public ones as open', () => {
    const wrong = operations
      .filter(({ method, path, op }) => {
        const secured = !!op.security?.some((s) => 'admin-jwt' in s);
        if (path.startsWith('/api/v1/admin/'))
          return !UNAUTHENTICATED_ADMIN.has(`${method} ${path}`) && !secured;
        return secured;
      })
      .map(({ method, path }) => `${method} ${path}`);
    expect(wrong).toEqual([]);
  });

  it('rejects unauthenticated requests to every protected admin route', async () => {
    const failures: string[] = [];
    for (const { method, path } of operations) {
      if (!path.startsWith('/api/v1/admin/') || UNAUTHENTICATED_ADMIN.has(`${method} ${path}`))
        continue;
      const url = path.replace(/\{[^}]+\}/g, '01928c1e-0000-7000-8000-000000000001');
      const res = await ctx.http()[method](url).send({});
      if (res.status !== 401) failures.push(`${method} ${path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('exposes only read endpoints under /public except event tracking', () => {
    const writes = operations
      .filter(({ method, path }) => path.startsWith('/api/v1/public/') && method !== 'get')
      .map(({ method, path }) => `${method} ${path}`);
    expect(writes).toEqual(['post /api/v1/public/events']);
  });
});
