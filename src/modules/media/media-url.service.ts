import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../config/env.validation';
import { MediaVariantType } from '../../generated/prisma/enums';

export interface MediaRecordForUrl {
  id: string;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  variants?: { variantType: MediaVariantType; storageKey: string; width: number; height: number; size: number; mimeType: string }[];
}

export interface MediaFileView {
  url: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
}

export interface MediaUrls {
  originalUrl: string;
  previewUrl: string;
  thumbnailUrl: string;
}

/** Selects everything needed to build media URLs (an ORIGINAL asset plus its derivatives). */
export const MEDIA_URL_SELECT = {
  id: true,
  storageKey: true,
  mimeType: true,
  width: true,
  height: true,
  size: true,
  variants: { select: { variantType: true, storageKey: true, width: true, height: true, size: true, mimeType: true } },
} as const;

/**
 * Builds public URLs exclusively from the trusted MEDIA_PUBLIC_BASE_URL setting (CDN),
 * never from request data, so URLs cannot be influenced by Host-header manipulation.
 */
@Injectable()
export class MediaUrlService {
  private readonly baseUrl: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.baseUrl = config.get('MEDIA_PUBLIC_BASE_URL', { infer: true }).replace(/\/+$/, '');
  }

  urlFor(storageKey: string): string {
    return `${this.baseUrl}/${storageKey.split('/').map(encodeURIComponent).join('/')}`;
  }

  urls(media: MediaRecordForUrl): MediaUrls {
    const preview = media.variants?.find((v) => v.variantType === 'PREVIEW');
    const thumb = media.variants?.find((v) => v.variantType === 'THUMBNAIL');
    const originalUrl = this.urlFor(media.storageKey);
    const previewUrl = preview ? this.urlFor(preview.storageKey) : originalUrl;
    return {
      originalUrl,
      previewUrl,
      thumbnailUrl: thumb ? this.urlFor(thumb.storageKey) : previewUrl,
    };
  }

  file(media: { storageKey: string; width: number; height: number; size: number; mimeType: string }): MediaFileView {
    return {
      url: this.urlFor(media.storageKey),
      width: media.width,
      height: media.height,
      size: media.size,
      mimeType: media.mimeType,
    };
  }
}
