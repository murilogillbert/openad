import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlaybackControllerComponent } from '../features/playback/components/playback-controller/playback-controller.component';
import { PairingPage } from '../pairing/pairing.page';
import { DeviceSessionService } from '../services/device-session.service';
import { PairingEventsService } from '../services/pairing-events.service';

/**
 * Tela unica do tablet: pareamento enquanto o device nao esta vinculado, player depois.
 *
 * Existe porque o app nao tem navegacao — nenhum `routerLink`, `router.navigate` ou
 * `navigateByUrl` em todo o `src`. Com `/playback` como rota separada, o player era
 * inalcancavel em runtime: a rota padrao caía em `pairing` e, em kiosk, nao ha barra de
 * endereco para sair de la. Trocar rota por estado remove a navegacao da equacao.
 */
@Component({
  selector: 'app-player-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PairingPage, PlaybackControllerComponent],
  template: `
    @if (paired()) {
      <app-playback-controller />
    } @else {
      <app-pairing-page />
    }
  `,
})
export class PlayerShellComponent {
  private readonly session = inject(DeviceSessionService);
  private readonly pairingEvents = inject(PairingEventsService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Começa `false` para que o SSR/prerender nunca monte o player. No browser, o valor real
   * vem do `Preferences` e so entao o player aparece.
   */
  readonly paired = signal(false);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.pairingEvents.pairingComplete$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.paired.set(true);
      });

    void this.resolveStoredPairing();
  }

  private async resolveStoredPairing(): Promise<void> {
    try {
      const deviceId = await this.session.getStoredDeviceId();
      this.paired.set(deviceId !== null);
    } catch {
      // Preferences indisponivel: mantem o pareamento na tela, que e o estado recuperavel.
      this.paired.set(false);
    }
  }
}
