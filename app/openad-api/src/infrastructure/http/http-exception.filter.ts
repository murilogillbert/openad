import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Request, Response } from 'express';
import {
  mapUnknownException,
  normalizeHttpException,
  type NormalizedHttpError,
} from '../errors';

type AwsSdkErrorDetails = {
  name?: string;
  message?: string;
  fault?: string;
  code?: string;
  requestId?: string;
  cfId?: string;
  httpStatusCode?: number;
  attempts?: number;
  totalRetryDelay?: number;
};

/**
 * Single place for API error semantics:
 * - All `HttpException` bodies normalized (domain `code`, validation, defaults)
 * - MongoDB / Mongoose / JWT errors mapped to HTTP status + stable codes
 * - Consistent JSON envelope + structured logs + `correlationId`
 *
 * @see `infrastructure/errors/` — `DomainHttpException`, `mapUnknownException`, `normalizeHttpException`
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(HttpExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logNonHttpException(exception);
      return;
    }

    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    const normalized: NormalizedHttpError =
      exception instanceof HttpException
        ? normalizeHttpException(exception)
        : mapUnknownException(exception);

    const correlationId = this.getCorrelationId(req);

    const aws = this.extractAwsSdkErrorDetails(exception);
    const logPayload = {
      correlationId,
      method: req.method,
      path: req.url,
      status: normalized.status,
      code: normalized.code,
      ...(aws ? { aws } : {}),
      err:
        exception instanceof Error
          ? { name: exception.name, message: exception.message }
          : String(exception),
    };

    if (normalized.status >= 500) {
      this.logger.error(
        {
          ...logPayload,
          stack: exception instanceof Error ? exception.stack : undefined,
        },
        'request failed'
      );
    } else if (normalized.status >= 400) {
      this.logger.warn(logPayload, 'client error');
    }

    res.status(normalized.status).json({
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details !== undefined ? { details: normalized.details } : {}),
        correlationId,
      },
    });
  }

  private getCorrelationId(req: Request & { id?: string }): string {
    const header = req.headers['x-correlation-id'];
    const fromHeader =
      typeof header === 'string'
        ? header
        : Array.isArray(header)
          ? header[0]
          : undefined;
    if (typeof req.id === 'string' && req.id.length > 0) {
      return req.id;
    }
    return fromHeader ?? 'unknown';
  }

  private logNonHttpException(exception: unknown): void {
    const normalized =
      exception instanceof HttpException
        ? normalizeHttpException(exception)
        : mapUnknownException(exception);

    const aws = this.extractAwsSdkErrorDetails(exception);
    if (exception instanceof Error) {
      this.logger.error(
        {
          code: normalized.code,
          ...(aws ? { aws } : {}),
          err: exception,
          stack: exception.stack,
        },
        'unhandled non-HTTP exception'
      );
    } else {
      this.logger.error(
        { code: normalized.code, ...(aws ? { aws } : {}), err: String(exception) },
        'unhandled non-HTTP exception'
      );
    }
  }

  /**
   * AWS SDK v3 (S3-compatible) errors frequently carry crucial debugging data in:
   * - `$metadata.httpStatusCode` (e.g. 403), `requestId`, retry info
   * - `Code` / `code` (e.g. AccessDenied, SignatureDoesNotMatch)
   *
   * We log only safe metadata (no headers/body/credentials).
   */
  private extractAwsSdkErrorDetails(exception: unknown): AwsSdkErrorDetails | null {
    if (!exception || typeof exception !== 'object') {
      return null;
    }

    const anyEx = exception as Record<string, unknown>;
    const meta =
      '$metadata' in anyEx && anyEx.$metadata && typeof anyEx.$metadata === 'object'
        ? (anyEx.$metadata as Record<string, unknown>)
        : null;

    const httpStatusCode =
      meta && typeof meta.httpStatusCode === 'number' ? meta.httpStatusCode : undefined;
    const requestId =
      meta && typeof meta.requestId === 'string' ? meta.requestId : undefined;
    const cfId = meta && typeof meta.cfId === 'string' ? meta.cfId : undefined;
    const attempts = meta && typeof meta.attempts === 'number' ? meta.attempts : undefined;
    const totalRetryDelay =
      meta && typeof meta.totalRetryDelay === 'number' ? meta.totalRetryDelay : undefined;

    const name =
      'name' in anyEx && typeof anyEx.name === 'string' ? anyEx.name : undefined;
    const message =
      'message' in anyEx && typeof anyEx.message === 'string'
        ? anyEx.message
        : undefined;
    const fault =
      '$fault' in anyEx && typeof anyEx.$fault === 'string'
        ? anyEx.$fault
        : undefined;

    // AWS SDK / S3 style: `Code` or `code` is often present.
    const code =
      (typeof anyEx.Code === 'string' && anyEx.Code) ||
      (typeof anyEx.code === 'string' && anyEx.code) ||
      undefined;

    const isLikelyAwsSdkError =
      meta !== null ||
      fault !== undefined ||
      code !== undefined ||
      (name ? /S3|ServiceException|AccessDenied|Signature/i.test(name) : false);

    if (!isLikelyAwsSdkError) {
      return null;
    }

    return {
      name,
      message,
      fault,
      code,
      requestId,
      cfId,
      httpStatusCode,
      attempts,
      totalRetryDelay,
    };
  }
}
