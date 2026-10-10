import type { AuthenticatedAdmin } from '../modules/auth/interfaces/authenticated-admin.interface';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      admin?: AuthenticatedAdmin;
    }
  }
}

export {};
