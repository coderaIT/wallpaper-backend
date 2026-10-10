import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { assertSafeKey, PutObjectOptions, StorageProvider, StoredObjectInfo } from './storage-provider.interface';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

/**
 * Works with any S3-compatible provider. When access keys are omitted, the AWS default
 * credential chain is used (IAM role, instance profile, env, ...), which is preferred in AWS.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    const config: S3ClientConfig = {
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.accessKeyId && options.secretAccessKey
        ? { credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } }
        : {}),
    };
    this.client = new S3Client(config);
  }

  async put(key: string, body: Buffer, options: PutObjectOptions): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ContentLength: body.length,
        CacheControl: options.cacheControl,
      }),
    );
  }

  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      batch.forEach(assertSafeKey);
      if (batch.length === 0) continue;
      const result = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.options.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (result.Errors && result.Errors.length > 0) {
        throw new Error(`Failed to delete ${result.Errors.length} object(s) from storage`);
      }
    }
  }

  async *list(prefix: string): AsyncIterable<StoredObjectInfo> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.options.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of page.Contents ?? []) {
        if (!obj.Key) continue;
        yield { key: obj.Key, size: obj.Size ?? 0, lastModified: obj.LastModified ?? new Date(0) };
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}
