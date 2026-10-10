import { MulterModuleOptions } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';

/**
 * Multer options shared by every upload endpoint. Files are buffered in memory (bounded by
 * the size and count limits) because they are fully decoded by Sharp anyway; content
 * validation happens in ImageProcessorService, per file, so bulk uploads can report
 * per-item errors.
 */
export function multerOptionsFactory(config: ConfigService<EnvironmentVariables, true>): MulterModuleOptions {
  return {
    storage: memoryStorage(),
    limits: {
      fileSize: config.get('MEDIA_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024,
      files: config.get('MEDIA_MAX_FILES_PER_UPLOAD', { infer: true }),
      fields: 20,
      fieldSize: 64 * 1024,
      parts: config.get('MEDIA_MAX_FILES_PER_UPLOAD', { infer: true }) + 20,
    },
  };
}

/** Strips path components and unsafe characters from a client-supplied file name. */
export function sanitizeFilename(name: string | undefined): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '')
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : null;
}
