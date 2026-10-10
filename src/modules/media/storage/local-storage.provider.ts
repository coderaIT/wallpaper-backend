import { mkdir, readdir, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  assertSafeKey,
  PutObjectOptions,
  StorageProvider,
  StoredObjectInfo,
} from './storage-provider.interface';

/**
 * Development storage: files on local disk, served by Express static middleware under
 * /media. Not intended for multi-instance production deployments.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;
  private readonly logger = new Logger(LocalStorageProvider.name);

  constructor(rootPath: string) {
    this.root = resolve(rootPath);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`Storage key escapes root: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer, _options: PutObjectOptions): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { flag: 'wx' });
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      const path = this.pathFor(key);
      await rm(path, { force: true });
      await this.pruneEmptyDirs(dirname(path));
    }
  }

  async *list(prefix: string): AsyncIterable<StoredObjectInfo> {
    assertSafeKey(prefix);
    const start = resolve(this.root, prefix);
    const boundary = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    // `startsWith(root)` alone also matches a sibling such as `<root>-backup`.
    if (start !== this.root && !start.startsWith(boundary)) return;
    yield* this.walk(start);
  }

  private async *walk(dir: string): AsyncIterable<StoredObjectInfo> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* this.walk(full);
      } else if (entry.isFile()) {
        const info = await stat(full);
        yield {
          key: relative(this.root, full).split(sep).join('/'),
          size: info.size,
          lastModified: info.mtime,
        };
      }
    }
  }

  private async pruneEmptyDirs(dir: string): Promise<void> {
    let current = dir;
    while (current.startsWith(this.root + sep)) {
      try {
        const entries = await readdir(current);
        if (entries.length > 0) return;
        // fs.rm() refuses directories unless recursive is set, including empty ones (EISDIR).
        await rmdir(current);
      } catch (error) {
        // Already removed by an earlier key in the same delete batch.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return;
        this.logger.debug(`Could not prune ${current}: ${String(error)}`);
        return;
      }
      current = dirname(current);
    }
  }
}
