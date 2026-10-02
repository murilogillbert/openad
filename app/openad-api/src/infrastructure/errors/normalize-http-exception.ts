import { HttpException } from '@nestjs/common';

/** Maps e.g. `BadRequestException` → `BAD_REQUEST`, `NotFoundException` → `NOT_FOUND`. */
export function httpExceptionClassToCode(exception: HttpException): string {
  const raw = exception.constructor.name.replace(/Exception$/, '');
  return raw
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toUpperCase();
}

export interface NormalizedHttpError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Flattens every Nest `HttpException` into a stable `{ code, message, details? }` shape.
 * Supports: string bodies, `{ code, message }` domain objects, and Nest validation bodies.
 */
export function normalizeHttpException(
  exception: HttpException
): NormalizedHttpError {
  const status = exception.getStatus();
  const body = exception.getResponse();

  if (typeof body === 'string') {
    return {
      status,
      code: httpExceptionClassToCode(exception),
      message: body,
    };
  }

  const o = body as Record<string, unknown>;

  if (
    typeof o['code'] === 'string' &&
    (typeof o['message'] === 'string' || Array.isArray(o['message']))
  ) {
    const message = Array.isArray(o['message'])
      ? (o['message'] as string[]).join(', ')
      : (o['message'] as string);
    const code = o['code'] as string;
    const rest = { ...o };
    delete rest['code'];
    delete rest['message'];
    const details = objectOrUndefined(rest as Record<string, unknown>);
    return {
      status,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    };
  }

  const message = extractNestMessage(o);
  const nested = o['error'];
  const nestedObj =
    nested && typeof nested === 'object' && nested !== null
      ? (nested as Record<string, unknown>)
      : null;
  const codeFromNested =
    nestedObj && typeof nestedObj['code'] === 'string'
      ? (nestedObj['code'] as string)
      : null;
  const codeFromError =
    typeof o['error'] === 'string'
      ? o['error'].replace(/\s+/g, '_').toUpperCase()
      : null;

  return {
    status,
    code: codeFromNested ?? codeFromError ?? httpExceptionClassToCode(exception),
    message,
    details: o,
  };
}

function extractNestMessage(o: Record<string, unknown>): string {
  const nested = o['error'];
  if (nested && typeof nested === 'object' && nested !== null) {
    const nm = (nested as Record<string, unknown>)['message'];
    if (typeof nm === 'string' && nm.length > 0) {
      return nm;
    }
  }
  if (Array.isArray(o['message'])) {
    return (o['message'] as string[]).join(', ');
  }
  if (typeof o['message'] === 'string') {
    return o['message'];
  }
  return 'Request failed';
}

function objectOrUndefined(
  rest: Record<string, unknown>
): unknown | undefined {
  const keys = Object.keys(rest).filter((k) => rest[k] !== undefined);
  if (keys.length === 0) return undefined;
  return rest;
}
