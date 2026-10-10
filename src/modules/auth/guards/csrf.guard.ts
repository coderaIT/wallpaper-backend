import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { CSRF_HEADER, REFRESH_COOKIE } from '../auth-cookies';
import { TokenService } from '../token.service';

/**
 * Protects cookie-authenticated endpoints (refresh/logout). The X-CSRF-Token header must
 * carry the HMAC bound to the refresh-token cookie; a cross-site request can attach the
 * cookie but cannot know this value.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const cookie = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
    if (!cookie) return true; // nothing to protect; the handler rejects the missing session
    if (!this.tokens.verifyCsrfToken(cookie, req.header(CSRF_HEADER))) {
      throw new ForbiddenException('Invalid CSRF token');
    }
    return true;
  }
}
