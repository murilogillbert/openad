import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { catchError, throwError } from 'rxjs';

function toastFromHttp(messages: MessageService, err: HttpErrorResponse): void {
  const status = err.status;
  const body = err.error as { error?: { message?: string; code?: string } } | undefined;
  const apiMessage =
    body && typeof body === 'object' && body.error && typeof body.error.message === 'string'
      ? body.error.message
      : err.message;
  let summary = `Error ${status}`;
  if (status === 0) summary = 'Network error';
  else if (status === 401) summary = 'Unauthorized';
  else if (status === 403) summary = 'Forbidden';
  else if (status === 404) summary = 'Not found';
  else if (status === 409) summary = 'Conflict';
  else if (status >= 500) summary = 'Server error';

  messages.add({
    severity: status >= 500 || status === 0 ? 'error' : 'warn',
    summary,
    detail: apiMessage || 'Request failed.',
    life: 7_000,
  });
}

/** Maps failed HTTP responses to standardized PrimeNG toasts (4xx/5xx). */
export const httpErrorToastInterceptor: HttpInterceptorFn = (req, next) => {
  const messages = inject(MessageService);
  const skipToast =
    req.url.includes('/auth/login') || req.url.includes('/auth/refresh');
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && !skipToast) {
        toastFromHttp(messages, err);
      }
      return throwError(() => err);
    })
  );
};
