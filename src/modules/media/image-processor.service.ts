import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp, { Sharp } from 'sharp';
import { EnvironmentVariables } from '../../config/env.validation';
import { MediaVariantType } from '../../generated/prisma/enums';

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const FORMAT_TO_MIME: Record<string, AllowedImageMime> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const MIME_TO_EXT: Record<AllowedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ProcessedVariant {
  variantType: MediaVariantType;
  buffer: Buffer;
  mimeType: AllowedImageMime;
  extension: string;
  width: number;
  height: number;
  size: number;
  checksumSha256: string;
}

export interface ProcessedImage {
  original: ProcessedVariant;
  preview: ProcessedVariant;
  thumbnail: ProcessedVariant;
}

// Disable libvips' operation cache: uploads are one-off and caching only holds memory.
sharp.cache(false);

/**
 * Validates and transforms uploaded images with Sharp:
 *  - real content sniffing (the declared MIME type must match the decoded format),
 *  - decompression-bomb protection via `limitInputPixels` + dimension limits,
 *  - EXIF auto-orientation, then metadata (EXIF/GPS/XMP/ICC) is stripped from all outputs,
 *  - aspect ratio preserved, never upscaled.
 *
 * The stored "original" is a full-resolution, orientation-corrected, metadata-free re-encode
 * in the source format, because it is publicly downloadable.
 */
@Injectable()
export class ImageProcessorService {
  private readonly maxInputPixels: number;
  private readonly maxDimension: number;
  private readonly minDimension: number;
  private readonly previewMax: number;
  private readonly thumbnailMax: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.maxInputPixels = config.get('MEDIA_MAX_INPUT_PIXELS', { infer: true });
    this.maxDimension = config.get('MEDIA_MAX_DIMENSION', { infer: true });
    this.minDimension = config.get('MEDIA_MIN_DIMENSION', { infer: true });
    this.previewMax = config.get('MEDIA_PREVIEW_MAX_DIMENSION', { infer: true });
    this.thumbnailMax = config.get('MEDIA_THUMBNAIL_MAX_DIMENSION', { infer: true });
  }

  async process(input: Buffer, declaredMime: string): Promise<ProcessedImage> {
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(declaredMime)) {
      throw new UnsupportedMediaTypeException('Only JPEG, PNG and WebP images are allowed');
    }
    if (input.length === 0) throw new BadRequestException('Uploaded file is empty');

    let metadata: sharp.Metadata;
    try {
      metadata = await this.open(input).metadata();
    } catch {
      throw new BadRequestException('File is not a valid or supported image');
    }

    const detectedMime = metadata.format ? FORMAT_TO_MIME[metadata.format] : undefined;
    if (!detectedMime) throw new UnsupportedMediaTypeException('Only JPEG, PNG and WebP images are allowed');
    if (detectedMime !== declaredMime) {
      throw new UnsupportedMediaTypeException(
        `File content (${detectedMime}) does not match the declared type (${declaredMime})`,
      );
    }
    if ((metadata.pages ?? 1) > 1) throw new BadRequestException('Animated or multi-page images are not supported');
    if (!metadata.width || !metadata.height) throw new BadRequestException('Unable to read image dimensions');

    const swap = (metadata.orientation ?? 1) >= 5;
    const width = swap ? metadata.height : metadata.width;
    const height = swap ? metadata.width : metadata.height;
    if (width * height > this.maxInputPixels) {
      throw new BadRequestException(`Image exceeds the maximum of ${this.maxInputPixels} pixels`);
    }
    if (Math.max(width, height) > this.maxDimension) {
      throw new BadRequestException(`Image dimensions must not exceed ${this.maxDimension}px`);
    }
    if (Math.min(width, height) < this.minDimension) {
      throw new BadRequestException(`Image dimensions must be at least ${this.minDimension}px`);
    }

    try {
      const [original, preview, thumbnail] = await Promise.all([
        this.render('ORIGINAL', this.encodeOriginal(this.open(input).rotate(), detectedMime), detectedMime),
        this.render('PREVIEW', this.resizeWebp(input, this.previewMax, 82), 'image/webp'),
        this.render('THUMBNAIL', this.resizeWebp(input, this.thumbnailMax, 75), 'image/webp'),
      ]);
      return { original, preview, thumbnail };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Image could not be processed (corrupt or unsupported data)');
    }
  }

  private open(input: Buffer): Sharp {
    return sharp(input, {
      limitInputPixels: this.maxInputPixels,
      failOn: 'error',
      sequentialRead: true,
      animated: false,
    });
  }

  private encodeOriginal(pipeline: Sharp, mime: AllowedImageMime): Sharp {
    switch (mime) {
      case 'image/jpeg':
        return pipeline.jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' });
      case 'image/png':
        return pipeline.png({ compressionLevel: 6, adaptiveFiltering: true });
      case 'image/webp':
        return pipeline.webp({ quality: 92, effort: 4 });
    }
  }

  private resizeWebp(input: Buffer, maxDimension: number, quality: number): Sharp {
    return this.open(input)
      .rotate()
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4 });
  }

  private async render(variantType: MediaVariantType, pipeline: Sharp, mime: AllowedImageMime): Promise<ProcessedVariant> {
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      variantType,
      buffer: data,
      mimeType: mime,
      extension: MIME_TO_EXT[mime],
      width: info.width,
      height: info.height,
      size: info.size,
      checksumSha256: createHash('sha256').update(data).digest('hex'),
    };
  }
}
