import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Preferred way to throw domain errors: stable `code`, user-safe `message`, optional `meta`.
 * The global filter normalizes this like any other `HttpException` with a `{ code, message }` body.
 */
export class DomainHttpException extends HttpException {
  constructor(
    domainCode: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    meta?: Record<string, unknown>
  ) {
    super(
      meta !== undefined
        ? { code: domainCode, message, meta }
        : { code: domainCode, message },
      status
    );
  }
}
