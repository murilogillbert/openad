import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'pairing' },
  {
    path: 'pairing',
    loadComponent: () =>
      import('./pairing/pairing.page').then((m) => m.PairingPage),
  },
  {
    path: 'playback',
    loadComponent: () =>
      import('./features/playback/components/playback-controller/playback-controller.component').then(
        (m) => m.PlaybackControllerComponent
      ),
  },
];
