import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedAdmin } from '../../modules/auth/interfaces/authenticated-admin.interface';

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
  const admin = ctx.switchToHttp().getRequest<Request>().admin;
  if (!admin) throw new UnauthorizedException('Authentication required');
  return admin;
});
