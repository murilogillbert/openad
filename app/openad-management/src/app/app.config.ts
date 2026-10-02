import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { AetherPreset } from '../theme/aether-preset';
import { PortalAuthService } from './auth/portal-auth.service';
import { ColorSchemeService } from './theme/color-scheme.service';
import { appRoutes } from './app.routes';
import { authRefreshInterceptor } from './auth/auth-refresh.interceptor';
import { authInterceptor } from './auth/auth.interceptor';
import { GlobalErrorHandler } from './shared/error/global-error-handler';
import { httpErrorToastInterceptor } from './shared/error/http-error-toast.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    MessageService,
    ConfirmationService,
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Required for `withFetch()` HttpClient in a zoneless app; otherwise async updates may not render
    // until a user interaction triggers change detection.
    provideZonelessChangeDetection(),
    provideAppInitializer(() => {
      inject(ColorSchemeService);
    }),
    provideAppInitializer(() => {
      // Keep shell user display name in sync with DB on first load.
      const auth = inject(PortalAuthService);
      if (auth.hasValidAccessToken()) {
        auth.refreshMe().subscribe({ error: () => undefined });
      }
    }),
    provideClientHydration(withEventReplay()),
    provideBrowserGlobalErrorListeners(),
    provideAnimations(),
    providePrimeNG({
      theme: {
        preset: AetherPreset,
        options: {
          prefix: 'p',
          darkModeSelector: '.dark',
          cssLayer: {
            name: 'primeng',
            order: 'theme, base, primeng',
          },
        },
      },
    }),
    provideHttpClient(
      withInterceptors([
        authInterceptor,
        httpErrorToastInterceptor,
        authRefreshInterceptor,
      ]),
      withFetch()
    ),
    provideRouter(appRoutes),
  ],
};
