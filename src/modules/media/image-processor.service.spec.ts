import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { ImageProcessorService } from './image-processor.service';

function makeProcessor(overrides: Record<string, number> = {}): ImageProcessorService {
  const values: Record<string, number> = {
    MEDIA_MAX_INPUT_PIXELS: 100_000_000,
    MEDIA_MAX_DIMENSION: 12_000,
    MEDIA_MIN_DIMENSION: 50,
    MEDIA_PREVIEW_MAX_DIMENSION: 600,
    MEDIA_THUMBNAIL_MAX_DIMENSION: 120,
    ...overrides,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new ImageProcessorService(config as never);
}

const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } });

describe('ImageProcessorService', () => {
  it('generates original, preview and thumbnail preserving aspect ratio', async () => {
    const input = await solid(1000, 2000).jpeg().toBuffer();
    const out = await makeProcessor().process(input, 'image/jpeg');

    expect(out.original).toMatchObject({ width: 1000, height: 2000, mimeType: 'image/jpeg', extension: 'jpg' });
    expect(out.preview).toMatchObject({ width: 300, height: 600, mimeType: 'image/webp' });
    expect(out.thumbnail).toMatchObject({ width: 60, height: 120, mimeType: 'image/webp' });
    expect(out.original.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('never upscales small images', async () => {
    const input = await solid(100, 80).png().toBuffer();
    const out = await makeProcessor().process(input, 'image/png');
    expect(out.preview).toMatchObject({ width: 100, height: 80 });
    expect(out.thumbnail).toMatchObject({ width: 100, height: 80 });
  });

  it('applies EXIF orientation and strips metadata', async () => {
    const input = await solid(300, 200)
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secret-owner', Artist: 'gps-person' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const out = await makeProcessor().process(input, 'image/jpeg');
    expect(out.original).toMatchObject({ width: 200, height: 300 });
    for (const variant of [out.original, out.preview, out.thumbnail]) {
      const meta = await sharp(variant.buffer).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(variant.buffer.includes(Buffer.from('secret-owner'))).toBe(false);
    }
  });

  it('rejects content that does not match the declared MIME type', async () => {
    const png = await solid(100, 100).png().toBuffer();
    await expect(makeProcessor().process(png, 'image/jpeg')).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects disallowed MIME types', async () => {
    const gif = await solid(100, 100).gif().toBuffer();
    await expect(makeProcessor().process(gif, 'image/gif')).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(makeProcessor().process(gif, 'image/png')).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects non-image data disguised as an image', async () => {
    const fake = Buffer.from('<?php echo "pwned"; ?>');
    await expect(makeProcessor().process(fake, 'image/jpeg')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects truncated / corrupt images', async () => {
    const jpeg = await solid(800, 800).jpeg().toBuffer();
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 3));
    await expect(makeProcessor().process(truncated, 'image/jpeg')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects images over the pixel limit (decompression bomb protection)', async () => {
    const input = await solid(1500, 1000).png().toBuffer();
    await expect(makeProcessor({ MEDIA_MAX_INPUT_PIXELS: 1_000_000 }).process(input, 'image/png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('enforces dimension limits', async () => {
    const tooSmall = await solid(40, 400).jpeg().toBuffer();
    await expect(makeProcessor().process(tooSmall, 'image/jpeg')).rejects.toThrow(/at least/);
    const tooWide = await solid(3000, 100).jpeg().toBuffer();
    await expect(makeProcessor({ MEDIA_MAX_DIMENSION: 2000 }).process(tooWide, 'image/jpeg')).rejects.toThrow(/exceed/);
  });

  it('rejects empty files', async () => {
    await expect(makeProcessor().process(Buffer.alloc(0), 'image/png')).rejects.toBeInstanceOf(BadRequestException);
  });
});
