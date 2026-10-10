import { HttpException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

/** Maps any error raised while processing one bulk item to a safe, client-facing error. */
export function toItemError(error: unknown): { statusCode: number; message: string } {
  if (error instanceof HttpException) {
    const res = error.getResponse();
    const message =
      typeof res === 'string'
        ? res
        : Array.isArray((res as { message?: unknown }).message)
          ? ((res as { message: string[] }).message).join('; ')
          : String((res as { message?: unknown }).message ?? error.message);
    return { statusCode: error.getStatus(), message };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return { statusCode: 409, message: 'Unique constraint violation' };
    if (error.code === 'P2025') return { statusCode: 404, message: 'Resource not found' };
    if (error.code === 'P2003') return { statusCode: 409, message: 'Relation constraint violation' };
  }
  return { statusCode: 500, message: 'Internal error while processing this item' };
}
