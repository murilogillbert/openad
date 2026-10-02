import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { PortalAuthService } from './portal-auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(PortalAuthService);
  const token = auth.getAccessToken();
  if (token) {
    return next(
      req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
      })
    );
  }
  return next(req);
};
