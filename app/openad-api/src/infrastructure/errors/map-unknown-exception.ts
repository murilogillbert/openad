import { HttpStatus } from '@nestjs/common';
import type { NormalizedHttpError } from './normalize-http-exception';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Maps non-HTTP exceptions (MongoDB, Mongoose, JWT, etc.) to API error codes.
 * Duck-typed so we do not depend on importing driver-specific classes.
 */
export function mapUnknownException(error: unknown): NormalizedHttpError {
  if (typeof error !== 'object' || error === null) {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: isProd ? 'Internal server error' : String(error),
    };
  }

  const e = error as Record<string, unknown> & { name?: string; message?: string };
  const name = typeof e.name === 'string' ? e.name : '';

  if (name === 'MongoServerError' && e['code'] === 11000) {
    return {
      status: HttpStatus.CONFLICT,
      code: 'DUPLICATE_KEY',
      message: 'A record with this unique value already exists',
      ...(isProd ? {} : { details: { keyValue: e['keyValue'] } }),
    };
  }

  if (name === 'ValidationError') {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
      message: isProd
        ? 'Document validation failed'
        : String(e.message ?? 'Document validation failed'),
      ...(isProd ? {} : { details: e }),
    };
  }

  if (name === 'CastError') {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'BAD_INPUT',
      message: isProd ? 'Invalid identifier or value' : String(e.message ?? 'Cast error'),
    };
  }

  if (name === 'InvalidTransitionException') {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'INVALID_TRANSITION',
      message: isProd
        ? 'Lifecycle transition is not allowed'
        : String(e.message ?? 'Invalid transition'),
    };
  }

  if (
    name === 'JsonWebTokenError' ||
    name === 'TokenExpiredError' ||
    name === 'NotBeforeError'
  ) {
    const code =
      name === 'TokenExpiredError'
        ? 'TOKEN_EXPIRED'
        : name === 'NotBeforeError'
          ? 'TOKEN_NOT_ACTIVE'
          : 'INVALID_TOKEN';
    return {
      status: HttpStatus.UNAUTHORIZED,
      code,
      message: String(e.message ?? 'Invalid token'),
    };
  }

  if (error instanceof Error) {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: isProd ? 'Internal server error' : error.message,
      ...(isProd ? {} : { details: { name: error.name } }),
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  };
}
