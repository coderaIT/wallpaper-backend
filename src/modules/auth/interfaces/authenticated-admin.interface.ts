import type { AdminRole } from '../../../generated/prisma/client';

/** Identity attached to `request.admin` by the JWT guard after a fresh database check. */
export interface AuthenticatedAdmin {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

export interface AccessTokenPayload {
  sub: string;
  role: AdminRole;
  /** Admin.tokenVersion at issue time. */
  ver: number;
}
