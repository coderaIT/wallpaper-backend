import { makeJpeg, makePng, makeWebp } from './utils/images';
import { adminSession, API, createTestApp, LoggedIn, resetDatabase, TestContext, uploadMedia } from './utils/test-app';

describe('Media management (e2e)', () => {
  let ctx: TestContext;
  let session: LoggedIn;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.storage.reset();
    session = await adminSession(ctx, 'EDITOR');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('uploads an image and creates original, preview and thumbnail', async () => {
    const res = await ctx
      .http()
      .post(`${API}/admin/media`)
      .set(session.auth)
      .attach('file', await makeJpeg(1000, 2000), { filename: '../../etc/My Photo.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const media = res.body.data;
    expect(media.original).toMatchObject({ width: 1000, height: 2000, mimeType: 'image/jpeg' });
    expect(media.preview.mimeType).toBe('image/webp');
    expect(media.thumbnail.width).toBeLessThanOrEqual(480);
    expect(media.original.url).toMatch(/^https:\/\/cdn\.test\.local\/media\/\d{4}\/\d{2}\/[0-9a-f-]+\/original\.jpg$/);
    expect(media.originalFilename).toBe('My Photo.jpg');
    expect(ctx.storage.objects.size).toBe(3);
    expect(await ctx.prisma.mediaAsset.count()).toBe(3);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|accessKey/i);
  });

  it('accepts PNG and WebP', async () => {
    await ctx.http().post(`${API}/admin/media`).set(session.auth).attach('file', await makePng(), { filename: 'a.png', contentType: 'image/png' }).expect(201);
    await ctx.http().post(`${API}/admin/media`).set(session.auth).attach('file', await makeWebp(), { filename: 'a.webp', contentType: 'image/webp' }).expect(201);
  });

  it('rejects non-image content and MIME spoofing', async () => {
    await ctx
      .http()
      .post(`${API}/admin/media`)
      .set(session.auth)
      .attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), { filename: 'evil.jpg', contentType: 'image/jpeg' })
      .expect(400);
    await ctx
      .http()
      .post(`${API}/admin/media`)
      .set(session.auth)
      .attach('file', await makePng(), { filename: 'fake.jpg', contentType: 'image/jpeg' })
      .expect(415);
    await ctx
      .http()
      .post(`${API}/admin/media`)
      .set(session.auth)
      .attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(415);
    await ctx.http().post(`${API}/admin/media`).set(session.auth).expect(400);
    expect(ctx.storage.objects.size).toBe(0);
    expect(await ctx.prisma.mediaAsset.count()).toBe(0);
  });

  it('rolls back stored objects when storage partially fails', async () => {
    ctx.storage.failNextPut(2);
    const res = await ctx
      .http()
      .post(`${API}/admin/media`)
      .set(session.auth)
      .attach('file', await makeJpeg(), { filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(502);
    expect(res.body.message).toMatch(/Failed to store/);
    expect(ctx.storage.objects.size).toBe(0);
    expect(await ctx.prisma.mediaAsset.count()).toBe(0);
  });

  it('bulk upload reports per-file results', async () => {
    const res = await ctx
      .http()
      .post(`${API}/admin/media/bulk`)
      .set(session.auth)
      .attach('files', await makeJpeg(), { filename: 'ok1.jpg', contentType: 'image/jpeg' })
      .attach('files', Buffer.from('nope'), { filename: 'bad.jpg', contentType: 'image/jpeg' })
      .attach('files', await makeWebp(), { filename: 'ok2.webp', contentType: 'image/webp' })
      .expect(200);
    expect(res.body.data.succeeded).toBe(2);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.results[1]).toMatchObject({ index: 1, filename: 'bad.jpg', status: 'error', error: { statusCode: 400 } });
  });

  it('lists media with pagination and unused filter, and gets metadata', async () => {
    const ids = [await uploadMedia(ctx, session), await uploadMedia(ctx, session), await uploadMedia(ctx, session)];
    const page = await ctx.http().get(`${API}/admin/media?page=1&limit=2`).set(session.auth).expect(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const one = await ctx.http().get(`${API}/admin/media/${ids[0]}`).set(session.auth).expect(200);
    expect(one.body.data.usage).toEqual({ wallpapers: 0, categories: 0, banners: 0 });

    await ctx.http().get(`${API}/admin/media/00000000-0000-4000-8000-000000000000`).set(session.auth).expect(404);
    await ctx.http().get(`${API}/admin/media/123`).set(session.auth).expect(400);
    await ctx.http().get(`${API}/admin/media?limit=1000`).set(session.auth).expect(400);
  });

  it('deletes unused media and its stored objects, but refuses referenced media', async () => {
    const unused = await uploadMedia(ctx, session);
    await ctx.http().delete(`${API}/admin/media/${unused}`).set(session.auth).expect(204);
    expect(ctx.storage.objects.size).toBe(0);
    expect(await ctx.prisma.mediaAsset.count()).toBe(0);

    const used = await uploadMedia(ctx, session);
    await ctx.prisma.category.create({ data: { name: 'C', slug: 'c', coverMediaId: used } });
    const res = await ctx.http().delete(`${API}/admin/media/${used}`).set(session.auth).expect(409);
    expect(res.body.details).toEqual({ wallpapers: 0, categories: 1, banners: 0 });
    expect(ctx.storage.objects.size).toBe(3);
  });

  it('orphan cleanup removes only old objects without a database row (SUPER_ADMIN)', async () => {
    await uploadMedia(ctx, session);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    ctx.storage.objects.set('media/2020/01/orphan/original.jpg', { body: Buffer.from('x'), contentType: 'image/jpeg', lastModified: old });
    ctx.storage.objects.set('media/2020/01/fresh/original.jpg', { body: Buffer.from('x'), contentType: 'image/jpeg', lastModified: new Date() });

    await ctx.http().post(`${API}/admin/media/cleanup`).set(session.auth).expect(403);

    const boss = await adminSession(ctx, 'SUPER_ADMIN');
    const dry = await ctx.http().post(`${API}/admin/media/cleanup`).set(boss.auth).expect(200);
    expect(dry.body.data).toMatchObject({ dryRun: true, orphanedObjects: 1, deletedObjects: 0 });

    const real = await ctx.http().post(`${API}/admin/media/cleanup?dryRun=false`).set(boss.auth).expect(200);
    expect(real.body.data).toMatchObject({ dryRun: false, deletedObjects: 1, orphanedKeys: ['media/2020/01/orphan/original.jpg'] });
    expect(ctx.storage.objects.has('media/2020/01/fresh/original.jpg')).toBe(true);
    expect(ctx.storage.objects.size).toBe(4);
  });
});
