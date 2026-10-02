import { Route } from '@angular/router';

/**
 * O tablet tem uma tela so: {@link PlayerShellComponent} decide entre pareamento e player.
 *
 * `pairing` e `playback` continuam existindo como redirecionamento porque eram as rotas
 * anteriores e podem estar em atalho, documentacao ou no estado salvo da WebView.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./shell/player-shell.component').then(
        (m) => m.PlayerShellComponent
      ),
  },
  { path: 'pairing', pathMatch: 'full', redirectTo: '' },
  { path: 'playback', pathMatch: 'full', redirectTo: '' },
  { path: '**', redirectTo: '' },
];
