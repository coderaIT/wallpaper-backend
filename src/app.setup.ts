import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { API_PREFIX, AppConfigService } from './config/app-config.type';
import { StorageDriver } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { ConfigService } from '@nestjs/config';

/**
 * Applies the global HTTP configuration. Shared by main.ts and the e2e test harness so
 * tests exercise exactly the same pipeline as production.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<AppConfigService>(ConfigService);

  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(config.get('TRUST_PROXY', { infer: true })));
  app.set('query parser', 'extended');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Swagger UI needs inline styles/scripts and data: images.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });

  const origins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  if (config.get('STORAGE_DRIVER', { infer: true }) === StorageDriver.Local) {
    app.useStaticAssets(resolve(config.get('LOCAL_STORAGE_PATH', { infer: true })), {
      prefix: '/media/',
      index: false,
      dotfiles: 'deny',
      fallthrough: true,
      maxAge: '7d',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    });
  }

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.enableShutdownHooks();
}

function parseTrustProxy(value: string): boolean | number | string {
  const v = value.trim().toLowerCase();
  if (v === 'false' || v === '') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number.parseInt(v, 10);
  return value;
}
