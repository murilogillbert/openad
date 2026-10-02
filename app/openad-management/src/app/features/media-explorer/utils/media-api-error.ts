import { HttpErrorResponse } from '@angular/common/http';

/** Parses Nest `HttpExceptionFilter` JSON: `{ error: { message, code } }`. */
export function messageFromApiHttpError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (body && typeof body === 'object' && body !== null && 'error' in body) {
      const inner = (body as { error?: { message?: unknown } }).error;
      if (typeof inner?.message === 'string' && inner.message.length > 0) {
        return inner.message;
      }
    }
    return err.message || `HTTP ${err.status}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Request failed';
}
