import type { Provider } from '@angular/core';
/**
 * Reserved for explicit geo feature registration; core services use `providedIn: 'root'`.
 * {@link SpatialRuntimeService} is bootstrapped via `APP_INITIALIZER` (see `app.config.ts`).
 */
export const GEO_FEATURE_PROVIDERS: Provider[] = [];
