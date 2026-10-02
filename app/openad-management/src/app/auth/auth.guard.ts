import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { PortalAuthService } from './portal-auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(PortalAuthService);
  const router = inject(Router);
  return auth.ensureValidSession().pipe(
    map((ok) => ok || router.parseUrl('/login'))
  );
};
