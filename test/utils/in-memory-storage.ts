import {
  PutObjectOptions,
  StorageProvider,
  StoredObjectInfo,
} from '../../src/modules/media/storage/storage-provider.interface';

/** Test double for object storage; can be told to fail puts to exercise compensation logic. */
export class InMemoryStorageProvider implements StorageProvider {
  readonly name = 'memory';
  readonly objects = new Map<string, { body: Buffer; contentType: string; lastModified: Date }>();
  /** When > 0, the Nth subsequent put call (1-based) fails. */
  failOnPutNumber = 0;
  private putCount = 0;

  async put(key: string, body: Buffer, options: PutObjectOptions): Promise<void> {
    this.putCount++;
    if (this.failOnPutNumber > 0 && this.putCount === this.failOnPutNumber) {
      throw new Error('Simulated storage failure');
    }
    this.objects.set(key, { body, contentType: options.contentType, lastModified: new Date() });
  }

  async delete(keys: string[]): Promise<void> {
    keys.forEach((k) => this.objects.delete(k));
  }

  async *list(prefix: string): AsyncIterable<StoredObjectInfo> {
    for (const [key, obj] of this.objects) {
      if (key.startsWith(prefix)) yield { key, size: obj.body.length, lastModified: obj.lastModified };
    }
  }

  reset(): void {
    this.objects.clear();
    this.failOnPutNumber = 0;
    this.putCount = 0;
  }

  failNextPut(nth = 1): void {
    this.putCount = 0;
    this.failOnPutNumber = nth;
  }
}
