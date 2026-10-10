import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum StorageDriver {
  Local = 'local',
  S3 = 's3',
}

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return value;
};

const toInt = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return value;
};

/**
 * Every environment variable consumed by the application. Validated once at boot so the
 * process fails fast on misconfiguration instead of failing on the first request.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  /** Comma-separated list of allowed browser origins for the admin dashboard. */
  @IsString()
  CORS_ORIGINS = '';

  /** Express "trust proxy" setting. Number of hops, or false. Required behind load balancers for correct client IPs. */
  @IsString()
  TRUST_PROXY = 'false';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  // ---- Auth ----
  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET: string;

  @Transform(toInt)
  @IsInt()
  @Min(60)
  @Max(3600)
  JWT_ACCESS_TTL_SECONDS = 900;

  @IsString()
  JWT_ISSUER = 'wallpaper-api';

  @IsString()
  JWT_AUDIENCE = 'wallpaper-admin';

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(90)
  REFRESH_TOKEN_TTL_DAYS = 7;

  @Transform(toBoolean)
  @IsBoolean()
  COOKIE_SECURE = true;

  @IsOptional()
  @IsString()
  COOKIE_DOMAIN?: string;

  @IsIn(['strict', 'lax', 'none'])
  COOKIE_SAME_SITE: 'strict' | 'lax' | 'none' = 'strict';

  // ---- Swagger ----
  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED = true;

  @IsOptional()
  @IsString()
  SWAGGER_USER?: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  SWAGGER_PASSWORD?: string;

  // ---- Rate limiting ----
  @Transform(toInt)
  @IsInt()
  @Min(1)
  THROTTLE_DEFAULT_LIMIT = 300;

  @Transform(toInt)
  @IsInt()
  @Min(1000)
  THROTTLE_DEFAULT_TTL_MS = 60_000;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  THROTTLE_AUTH_LIMIT = 10;

  @Transform(toInt)
  @IsInt()
  @Min(1000)
  THROTTLE_AUTH_TTL_MS = 60_000;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  THROTTLE_EVENTS_LIMIT = 120;

  @Transform(toInt)
  @IsInt()
  @Min(1000)
  THROTTLE_EVENTS_TTL_MS = 60_000;

  // ---- Storage ----
  @IsEnum(StorageDriver)
  STORAGE_DRIVER: StorageDriver = StorageDriver.Local;

  @IsString()
  LOCAL_STORAGE_PATH = './storage';

  /** Trusted base URL used to build public media URLs (CDN or bucket website). */
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  MEDIA_PUBLIC_BASE_URL = 'http://localhost:3000/media';

  @ValidateIf((o: EnvironmentVariables) => o.STORAGE_DRIVER === StorageDriver.S3)
  @IsString()
  @IsNotEmpty()
  S3_BUCKET?: string;

  @ValidateIf((o: EnvironmentVariables) => o.STORAGE_DRIVER === StorageDriver.S3)
  @IsString()
  @IsNotEmpty()
  S3_REGION?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_ACCESS_KEY?: string;

  @Transform(toBoolean)
  @IsBoolean()
  S3_FORCE_PATH_STYLE = false;

  // ---- Media processing ----
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100)
  MEDIA_MAX_FILE_SIZE_MB = 25;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(50)
  MEDIA_MAX_FILES_PER_UPLOAD = 20;

  @Transform(toInt)
  @IsInt()
  @Min(1_000_000)
  MEDIA_MAX_INPUT_PIXELS = 100_000_000;

  @Transform(toInt)
  @IsInt()
  @Min(256)
  MEDIA_MAX_DIMENSION = 12_000;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  MEDIA_MIN_DIMENSION = 200;

  @Transform(toInt)
  @IsInt()
  @Min(256)
  MEDIA_PREVIEW_MAX_DIMENSION = 2048;

  @Transform(toInt)
  @IsInt()
  @Min(64)
  MEDIA_THUMBNAIL_MAX_DIMENSION = 480;

  /** 0 disables the periodic orphaned-object sweep. */
  @Transform(toInt)
  @IsInt()
  @Min(0)
  MEDIA_ORPHAN_CLEANUP_INTERVAL_MINUTES = 0;

  // ---- Public API / analytics ----
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(3600)
  PUBLIC_CACHE_TTL_SECONDS = 30;

  @Transform(toInt)
  @IsInt()
  @Min(100)
  ANALYTICS_FLUSH_INTERVAL_MS = 5000;

  @Transform(toInt)
  @IsInt()
  @Min(1)
  ANALYTICS_RAW_EVENT_RETENTION_DAYS = 90;

  /** Comma-separated host allowlist for banner external URLs. Empty = any public https host. */
  @IsString()
  BANNER_URL_ALLOWED_HOSTS = '';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false, whitelist: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  if (validated.NODE_ENV === NodeEnv.Production) {
    if (validated.SWAGGER_ENABLED && (!validated.SWAGGER_USER || !validated.SWAGGER_PASSWORD)) {
      throw new Error(
        'Invalid environment configuration: SWAGGER_USER and SWAGGER_PASSWORD are required when Swagger is enabled in production',
      );
    }
    if (!validated.COOKIE_SECURE) {
      throw new Error('Invalid environment configuration: COOKIE_SECURE must be true in production');
    }
    assertProductionMediaUrl(validated.MEDIA_PUBLIC_BASE_URL);
  }
  if (validated.COOKIE_SAME_SITE === 'none' && !validated.COOKIE_SECURE) {
    throw new Error('Invalid environment configuration: COOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
  }
  return validated;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/** Production image links must be public https URLs. Loopback hosts would break the mobile app. */
export function assertProductionMediaUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid environment configuration: MEDIA_PUBLIC_BASE_URL is not a valid absolute URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Invalid environment configuration: MEDIA_PUBLIC_BASE_URL must use https in production');
  }
  const host = parsed.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) || host.endsWith('.local')) {
    throw new Error('Invalid environment configuration: MEDIA_PUBLIC_BASE_URL must not point at localhost in production');
  }
}
