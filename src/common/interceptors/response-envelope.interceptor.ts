import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Paginated } from '../dto/pagination.dto';

/**
 * Normalizes every successful JSON response to `{ data }` or `{ data, meta }`.
 * `undefined` results (e.g. 204 No Content) are left untouched.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    return next.handle().pipe(
      map((body: unknown) => {
        if (body === undefined || body instanceof StreamableFile) return body;
        if (body instanceof Paginated) return { data: body.data, meta: body.meta };
        return { data: body };
      }),
    );
  }
}
