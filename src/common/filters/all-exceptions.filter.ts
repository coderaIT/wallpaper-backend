import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
  requestId?: string;
}

/**
 * Converts every thrown error into a safe, consistent JSON error body.
 * Internal error details (stack traces, SQL, Prisma meta) are logged but never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, details } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.path} -> ${status} [${request.requestId ?? '-'}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      error: httpStatusName(status),
      message,
      ...(details !== undefined ? { details } : {}),
      path: request.path,
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
    };
    if (!response.headersSent) response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; message: string; details?: unknown } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') return { status, message: res };
      const obj = res as { message?: unknown; details?: unknown };
      if (Array.isArray(obj.message)) {
        return { status, message: 'Validation failed', details: obj.message };
      }
      return {
        status,
        message: typeof obj.message === 'string' ? obj.message : exception.message,
        details: obj.details,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { status: HttpStatus.CONFLICT, message: 'A record with the same unique value already exists' };
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, message: 'Resource not found' };
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            message: 'Operation violates a relation constraint (resource is referenced or missing)',
          };
        default:
          return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
      }
    }

    if (isBodyParserError(exception)) {
      return { status: exception.status, message: exception.status === 413 ? 'Payload too large' : 'Malformed request body' };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
}

function isBodyParserError(e: unknown): e is { status: number; type: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'type' in e &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number' &&
    (e as { status: number }).status >= 400 &&
    (e as { status: number }).status < 500
  );
}

function httpStatusName(status: number): string {
  const name = HttpStatus[status];
  if (!name) return status >= 500 ? 'Internal Server Error' : 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
