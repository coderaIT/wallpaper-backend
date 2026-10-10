import { timingSafeEqual } from 'node:crypto';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import { AppConfigService } from './config/app-config.type';
import { NodeEnv } from './config/env.validation';

export const SWAGGER_PATH = 'api/docs';

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Wallpaper CMS API')
    .setDescription(
      [
        'REST API for the Wallpaper mobile application (`/api/v1/public/*`, no login) and its Admin Dashboard (`/api/v1/admin/*`, JWT).',
        '',
        '**Response envelope:** successful responses are `{ "data": ... }`; paginated lists are `{ "data": [...], "meta": { page, limit, total, totalPages } }`.',
        'Errors are `{ statusCode, error, message, details?, path, timestamp, requestId }`.',
        '',
        '**Admin auth:** `POST /admin/auth/login` returns a short-lived access token (send as `Authorization: Bearer <token>`) and sets an HttpOnly refresh-token cookie plus a readable `csrf_token` cookie. `POST /admin/auth/refresh` and `/logout` require the `X-CSRF-Token` header to equal the `csrf_token` cookie.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'admin-jwt')
    .addTag('Health')
    .addTag('Admin / Auth')
    .addTag('Admin / Admins')
    .addTag('Admin / Media')
    .addTag('Admin / Categories')
    .addTag('Admin / Wallpapers')
    .addTag('Admin / Banners')
    .addTag('Admin / Home Sections')
    .addTag('Admin / Settings')
    .addTag('Admin / Analytics')
    .addTag('Admin / Dashboard')
    .addTag('Admin / Audit Logs')
    .addTag('Public')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupSwagger(app: INestApplication): void {
  const config = app.get<AppConfigService>(ConfigService);
  if (!config.get('SWAGGER_ENABLED', { infer: true })) return;

  const user = config.get('SWAGGER_USER', { infer: true });
  const password = config.get('SWAGGER_PASSWORD', { infer: true });
  if (user && password) {
    app.use(['/api/docs', '/api/docs-json', '/api/docs-yaml'], basicAuth(user, password));
  } else if (config.get('NODE_ENV', { infer: true }) === NodeEnv.Production) {
    return;
  }

  SwaggerModule.setup(SWAGGER_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: false },
  });
  new Logger('Swagger').log(`OpenAPI docs available at /${SWAGGER_PATH}`);
}

function basicAuth(user: string, password: string) {
  const expected = Buffer.from(`${user}:${password}`);
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const given = Buffer.from(Buffer.from(encoded, 'base64').toString('utf8'));
      if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="API docs"');
    res.status(401).send('Authentication required');
  };
}
