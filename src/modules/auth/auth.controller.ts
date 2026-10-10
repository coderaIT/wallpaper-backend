import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { EnvironmentVariables } from '../../config/env.validation';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ApiAdminAuth, ApiTooManyRequests, ApiValidationError } from '../../common/swagger/api-responses';
import { UseThrottleProfile } from '../../common/throttling/throttle-profile.decorator';
import { AuthService, AuthSession } from './auth.service';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './auth-cookies';
import { AdminProfileDto, AuthTokensResponseDto, ChangePasswordDto, LoginDto } from './dto/auth.dto';
import { CsrfGuard } from './guards/csrf.guard';
import { AuthenticatedAdmin } from './interfaces/authenticated-admin.interface';
import { TokenService } from './token.service';

const tokensExample = {
  data: {
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIuLi4ifQ.signature',
    tokenType: 'Bearer',
    expiresIn: 900,
    csrfToken: 'q2Vb3l0n9V0hR1m3m2l1nQk7d8Yp4s6t',
    admin: { id: '01928c1e-0000-7000-8000-000000000001', name: 'Super Admin', email: 'admin@example.com', role: 'SUPER_ADMIN' },
  },
};

@ApiTags('Admin / Auth')
@Controller('admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Public()
  @UseThrottleProfile('auth')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin login',
    description:
      'Validates credentials and returns a short-lived access token. Sets an HttpOnly `refresh_token` cookie (path `/api/v1/admin/auth`) and a readable `csrf_token` cookie. Accounts lock for 15 minutes after 5 consecutive failures.',
  })
  @ApiBody({ type: LoginDto, examples: { default: { value: { email: 'admin@example.com', password: 'S3cure-Passw0rd!' } } } })
  @ApiOkResponse({ type: AuthTokensResponseDto, schema: { example: tokensExample } })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiForbiddenResponse({ description: 'Account is disabled' })
  @ApiValidationError()
  @ApiTooManyRequests()
  async login(
    @Body() dto: LoginDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponseDto> {
    const session = await this.auth.login(dto.email, dto.password, meta);
    return this.respondWithSession(res, session);
  }

  @Public()
  @UseThrottleProfile('auth')
  @UseGuards(CsrfGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiHeader({ name: 'X-CSRF-Token', required: true, description: 'Value of the csrf_token cookie / last csrfToken' })
  @ApiOperation({
    summary: 'Rotate refresh token',
    description:
      'Exchanges the refresh-token cookie for a new access token and a new refresh token (rotation). Re-use of an already rotated token revokes the whole session family.',
  })
  @ApiOkResponse({ type: AuthTokensResponseDto, schema: { example: tokensExample } })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid, expired, or reused refresh token' })
  @ApiForbiddenResponse({ description: 'Invalid CSRF token' })
  @ApiTooManyRequests()
  async refresh(
    @Req() req: Request,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponseDto> {
    try {
      const session = await this.auth.refresh(this.readRefreshCookie(req), meta);
      return this.respondWithSession(res, session);
    } catch (error) {
      if (error instanceof UnauthorizedException) clearAuthCookies(res, this.config);
      throw error;
    }
  }

  @Public()
  @UseThrottleProfile('auth')
  @Get('csrf')
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({
    summary: 'Get CSRF token for the current refresh-token cookie',
    description:
      'For dashboards hosted on a different domain that cannot read the csrf_token cookie (e.g. after a page reload). Readable only by CORS-allowed origins.',
  })
  @ApiOkResponse({ schema: { example: { data: { csrfToken: 'q2Vb3l0n9V0hR1m3m2l1nQk7d8Yp4s6t' } } } })
  @ApiUnauthorizedResponse({ description: 'No refresh-token cookie' })
  csrf(@Req() req: Request): { csrfToken: string } {
    const cookie = this.readRefreshCookie(req);
    if (!cookie) throw new UnauthorizedException('No active session');
    return { csrfToken: this.tokens.csrfTokenFor(cookie) };
  }

  @Public()
  @UseGuards(CsrfGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({ summary: 'Logout', description: 'Revokes the refresh-token session family and clears auth cookies. Idempotent.' })
  @ApiNoContentResponse({ description: 'Logged out' })
  @ApiForbiddenResponse({ description: 'Invalid CSRF token' })
  async logout(
    @Req() req: Request,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.readRefreshCookie(req), meta);
    clearAuthCookies(res, this.config);
  }

  @Get('me')
  @ApiAdminAuth()
  @ApiOperation({ summary: 'Current admin profile' })
  @ApiOkResponse({ type: AdminProfileDto, schema: { example: { data: tokensExample.data.admin } } })
  me(@CurrentAdmin() admin: AuthenticatedAdmin): Promise<AdminProfileDto> {
    return this.auth.getProfile(admin.id);
  }

  @Post('change-password')
  @UseThrottleProfile('auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAdminAuth()
  @ApiOperation({
    summary: 'Change own password',
    description: 'Requires the current password. Revokes all refresh tokens (all sessions must log in again).',
  })
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiValidationError()
  async changePassword(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: ChangePasswordDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(admin.id, dto.currentPassword, dto.newPassword, meta);
    clearAuthCookies(res, this.config);
  }

  private readRefreshCookie(req: Request): string | undefined {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
    return typeof value === 'string' ? value : undefined;
  }

  private respondWithSession(res: Response, session: AuthSession): AuthTokensResponseDto {
    const csrfToken = this.tokens.csrfTokenFor(session.refreshToken.value);
    setAuthCookies(
      res,
      this.config,
      session.refreshToken.value,
      csrfToken,
      session.refreshToken.expiresAt,
    );
    res.setHeader('Cache-Control', 'no-store');
    return {
      accessToken: session.accessToken,
      tokenType: 'Bearer',
      expiresIn: session.expiresIn,
      csrfToken,
      admin: session.admin,
    };
  }
}
