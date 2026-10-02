import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { PortalAuthService } from './portal-auth.service';

/** Angular normalizes header names; match with lowercase in clone + has(). */
const AUTH_RETRY = 'x-auth-retry';

/** After a 401, try refresh once then replay the request with the new access token. */
export const authRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(PortalAuthService);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) {
        return throwError(() => err);
      }
      const url = req.url;
      if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
        return throwError(() => err);
      }
      if (req.headers.has(AUTH_RETRY)) {
        auth.clearSession();
        return throwError(() => err);
      }
      if (!req.headers.has('Authorization')) {
        return throwError(() => err);
      }
      const refresh = auth.getRefreshToken();
      if (!refresh) {
        auth.clearSession();
        return throwError(() => err);
      }
      return auth.refreshSession().pipe(
        switchMap(() => {
          const token = auth.getAccessToken();
          if (!token) {
            auth.clearSession();
            return throwError(() => err);
          }
          const retry = req.clone({
            setHeaders: {
              Authorization: `Bearer ${token}`,
              [AUTH_RETRY]: '1',
            },
          });
          return next(retry);
        }),
        catchError(() => {
          auth.clearSession();
          return throwError(() => err);
        })
      );
    })
  );
};
