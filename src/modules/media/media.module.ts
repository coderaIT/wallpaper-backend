import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { EnvironmentVariables, StorageDriver } from '../../config/env.validation';
import { ImageProcessorService } from './image-processor.service';
import { MediaUrlService } from './media-url.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { LocalStorageProvider } from './storage/local-storage.provider';
import { S3StorageProvider } from './storage/s3-storage.provider';
import { STORAGE_PROVIDER, StorageProvider } from './storage/storage-provider.interface';
import { multerOptionsFactory } from './upload-options';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: multerOptionsFactory,
    }),
  ],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaUrlService,
    ImageProcessorService,
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): StorageProvider => {
        if (config.get('STORAGE_DRIVER', { infer: true }) === StorageDriver.S3) {
          return new S3StorageProvider({
            bucket: config.get('S3_BUCKET', { infer: true })!,
            region: config.get('S3_REGION', { infer: true })!,
            endpoint: config.get('S3_ENDPOINT', { infer: true }),
            accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
            secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
            forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
          });
        }
        return new LocalStorageProvider(config.get('LOCAL_STORAGE_PATH', { infer: true }));
      },
    },
  ],
  exports: [MediaService, MediaUrlService, ImageProcessorService],
})
export class MediaModule {}
