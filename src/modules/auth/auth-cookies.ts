import { CookieOptions, Response } from 'express';
import { API_PREFIX, AppConfigService } from '../../config/app-config.type';

export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';
/** The refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/admin/auth`;

function baseOptions(config: AppConfigService): CookieOptions {
  const domain = config.get('COOKIE_DOMAIN', { infer: true });
  return {
    secure: config.get('COOKIE_SECURE', { infer: true }),
    sameSite: config.get('COOKIE_SAME_SITE', { infer: true }),
    ...(domain ? { domain } : {}),
  };
}

export function setAuthCookies(
  res: Response,
  config: AppConfigService,
  refreshToken: string,
  csrfToken: string,
  expiresAt: Date,
): void {
  const base = baseOptions(config);
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
  // Readable by dashboard JS (same-site deployments) so it can echo it in X-CSRF-Token.
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...base,
    httpOnly: false,
    path: '/',
    expires: expiresAt,
  });
}

export function clearAuthCookies(res: Response, config: AppConfigService): void {
  const base = baseOptions(config);
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true, path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false, path: '/' });
}
