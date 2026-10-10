import { assertProductionMediaUrl, validateEnv } from './env.validation';

function productionEnv(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://wallpaper:secret@db.internal:5432/wallpaper',
    JWT_ACCESS_SECRET: 'x'.repeat(48),
    COOKIE_SECURE: 'true',
    SWAGGER_ENABLED: 'false',
    MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com/media',
    CORS_ORIGINS: 'https://admin.example.com',
    ...overrides,
  };
}

describe('production media URL', () => {
  it('accepts a public https base URL', () => {
    expect(validateEnv(productionEnv()).MEDIA_PUBLIC_BASE_URL).toBe('https://cdn.example.com/media');
  });

  it('rejects localhost and plain http in production', () => {
    expect(() => validateEnv(productionEnv({ MEDIA_PUBLIC_BASE_URL: 'http://localhost:3000/media' }))).toThrow(
      /https/,
    );
    expect(() => validateEnv(productionEnv({ MEDIA_PUBLIC_BASE_URL: 'https://localhost/media' }))).toThrow(
      /localhost/,
    );
    expect(() => assertProductionMediaUrl('https://127.0.0.1/media')).toThrow(/localhost/);
  });

  it('still allows localhost outside production', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://wallpaper:secret@localhost:5432/wallpaper_dev',
      JWT_ACCESS_SECRET: 'x'.repeat(48),
      COOKIE_SECURE: 'false',
      MEDIA_PUBLIC_BASE_URL: 'http://localhost:3000/media',
    });
    expect(env.MEDIA_PUBLIC_BASE_URL).toBe('http://localhost:3000/media');
  });
});
