import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AdminRole } from '../../generated/prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

/** Global guard enforcing @Roles(). Runs after JwtAuthGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, targets);
    if (!required || required.length === 0) return true;

    const admin = context.switchToHttp().getRequest<Request>().admin;
    if (!admin || !required.includes(admin.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
