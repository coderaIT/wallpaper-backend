export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface PutObjectOptions {
  contentType: string;
  cacheControl?: string;
}

export interface StoredObjectInfo {
  key: string;
  size: number;
  lastModified: Date;
}

/**
 * Provider-agnostic object storage contract. Business logic depends only on this interface,
 * so switching between local disk, AWS S3, R2, MinIO, etc. is a configuration change.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, options: PutObjectOptions): Promise<void>;
  /** Deletes the given keys; missing keys are ignored. */
  delete(keys: string[]): Promise<void>;
  /** Iterates all objects below a prefix. */
  list(prefix: string): AsyncIterable<StoredObjectInfo>;
}

/** Keys are generated server-side; this guards against path traversal regardless. */
export const STORAGE_KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,500}$/;

export function assertSafeKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
