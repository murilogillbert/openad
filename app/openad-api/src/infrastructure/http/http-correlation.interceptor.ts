import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';

/**
 * Echoes the request correlation id on every HTTP response so clients can tie errors to logs.
 * The id comes from pino-http (`req.id`) or `X-Correlation-Id`.
 */
@Injectable()
export class HttpCorrelationInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request & { id?: string }>();
    const res = context.switchToHttp().getResponse<Response>();

    const header = req.headers['x-correlation-id'];
    const fromHeader =
      typeof header === 'string'
        ? header
        : Array.isArray(header)
          ? header[0]
          : undefined;

    const id =
      typeof req.id === 'string' && req.id.length > 0 ? req.id : fromHeader;

    if (id) {
      res.setHeader('X-Correlation-Id', id);
    }

    return next.handle();
  }
}
