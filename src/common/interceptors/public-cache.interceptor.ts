import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { EnvironmentVariables } from '../../config/env.validation';

/** Adds shared-cache headers to successful public GET responses (CDN / client friendly). */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  private readonly maxAge: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.maxAge = config.get('PUBLIC_CACHE_TTL_SECONDS', { infer: true });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap(() => {
        if (req.method === 'GET' && res.statusCode === 200 && !res.getHeader('Cache-Control')) {
          res.setHeader('Vary', 'Accept-Language');
          res.setHeader(
            'Cache-Control',
            this.maxAge > 0 ? `public, max-age=${this.maxAge}, stale-while-revalidate=${this.maxAge * 2}` : 'no-cache',
          );
        }
      }),
    );
  }
}
