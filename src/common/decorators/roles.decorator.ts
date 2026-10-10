import { SetMetadata } from '@nestjs/common';
import { AdminRole } from '../../generated/prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route/controller to the given roles. Without this decorator any authenticated,
 * active admin may access a (non-public) route.
 */
export const Roles = (...roles: AdminRole[]): ClassDecorator & MethodDecorator => SetMetadata(ROLES_KEY, roles);
