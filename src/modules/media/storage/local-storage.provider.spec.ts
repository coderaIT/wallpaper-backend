import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageProvider } from './local-storage.provider';

describe('LocalStorageProvider', () => {
  let root: string;
  let storage: LocalStorageProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wallpaper-storage-'));
    storage = new LocalStorageProvider(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores objects under the configured root and lists them by prefix', async () => {
    const key = 'media/2026/10/abc/original.jpg';
    const body = Buffer.from('jpeg-bytes');
    await storage.put(key, body, {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    });

    await expect(
      readFile(join(root, 'media', '2026', '10', 'abc', 'original.jpg')),
    ).resolves.toEqual(body);

    const listed = [];
    for await (const obj of storage.list('media/')) listed.push(obj);
    expect(listed).toEqual([expect.objectContaining({ key, size: body.length })]);
    expect(listed[0]?.lastModified.getTime()).toEqual(expect.any(Number));

    await storage.delete([key, 'media/does-not-exist.jpg']);
    const after = [];
    for await (const obj of storage.list('media/')) after.push(obj);
    expect(after).toEqual([]);
    await expect(stat(join(root, 'media'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects keys that escape the storage root', async () => {
    await expect(
      storage.put('../outside.txt', Buffer.from('x'), { contentType: 'text/plain' }),
    ).rejects.toThrow(/Unsafe storage key/);
    await expect(storage.delete(['media/../../etc/passwd'])).rejects.toThrow(/Unsafe storage key/);
  });
});
