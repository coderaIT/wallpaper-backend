import sharp from 'sharp';

export function makeJpeg(width = 400, height = 800, color = { r: 30, g: 90, b: 160 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

export function makePng(width = 400, height = 400): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } } }).png().toBuffer();
}

export function makeWebp(width = 800, height = 400): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 200, b: 10 } } }).webp().toBuffer();
}
