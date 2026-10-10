import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../../modules/auth/token.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Global guard: every route requires a valid admin access token unless marked @Public().
 * The admin is re-loaded from the database on each request so that disabling an account,
 * changing its role or changing/resetting its password (token version bump) takes effect
 * immediately, not when the access token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header('authorization');
    const match = header
      ? /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header)
      : null;
    if (!match) throw new UnauthorizedException('Authentication required');

    const payload = await this.tokens.verifyAccessToken(match[1]);
    if (!payload) throw new UnauthorizedException('Invalid or expired access token');

    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, isActive: true, tokenVersion: true },
    });
    if (!admin || admin.tokenVersion !== payload.ver)
      throw new UnauthorizedException('Invalid or expired access token');
    if (!admin.isActive) throw new ForbiddenException('Account is disabled');

    req.admin = { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
    return true;
  }
}
