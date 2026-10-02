import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { PortalAuthService } from './portal-auth.service';

/** Allow `/login` only when there is no valid session (expired access is refreshed first). */
export const loginGuard: CanActivateFn = () => {
  const auth = inject(PortalAuthService);
  const router = inject(Router);
  return auth.ensureValidSession().pipe(
    map((ok) => (ok ? router.parseUrl('/dashboard') : true))
  );
};
