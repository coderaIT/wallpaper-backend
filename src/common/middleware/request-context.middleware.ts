import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Assigns a request id (honouring a well-formed incoming `X-Request-Id`) and logs one line
 * per request. Only method, path, status and duration are logged: never bodies, query
 * strings, cookies or authorization headers.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const line = `${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${ms.toFixed(1)}ms [${requestId}]`;
      if (res.statusCode >= 500) this.logger.error(line);
      else if (res.statusCode >= 400) this.logger.warn(line);
      else this.logger.log(line);
    });
    next();
  }
}
