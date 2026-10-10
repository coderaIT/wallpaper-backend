import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function extractRequestMeta(req: Request): RequestMeta {
  const ua = req.header('user-agent');
  return {
    ip: req.ip ? req.ip.slice(0, 64) : null,
    userAgent: ua ? ua.slice(0, 255) : null,
  };
}

/** Injects the caller's IP (respecting trust proxy) and user agent, truncated to column sizes. */
export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta =>
  extractRequestMeta(ctx.switchToHttp().getRequest<Request>()),
);
