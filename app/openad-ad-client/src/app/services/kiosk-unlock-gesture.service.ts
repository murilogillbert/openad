import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { TabletNativeIntegrationService } from './tablet-native-integration.service';

/** Ponte nativa de `OpenAdVolumeKeyPlugin.kt`. */
interface OpenAdVolumeKeyPlugin {
  addListener(
    event: 'volumeDown',
    cb: (data: { pressed: boolean }) => void
  ): Promise<PluginListenerHandle>;
}

const VolumeKey = registerPlugin<OpenAdVolumeKeyPlugin>('OpenAdVolumeKey');

/** Quanto tempo as duas condicoes precisam coexistir. */
export const SEGURAR_MS = 5_000;

/** Quanto tempo o quiosque fica liberado depois do gesto. */
export const LIBERACAO_S = 120;

/**
 * Destrava o quiosque com toque mantido na tela **junto** com volume para baixo por 5 s.
 *
 * O tablete fica em Lock Task, sem home, sem recentes e sem barra de status, e o conteudo
 * nao responde a toque — e o que impede o passageiro de mexer. Mas um aparelho que nao pode
 * ser liberado em campo e um aparelho que volta para a oficina por qualquer coisa, entao
 * precisa haver uma saida local. Duas condicoes simultaneas, e nao um toque longo sozinho,
 * porque toque longo acontece por acidente: alguem apoia a mao na tela.
 *
 * A metade de volume **tem** de vir do lado nativo. A WebView nao recebe tecla de volume no
 * JavaScript: o sistema entrega essas teclas a Activity e elas nao chegam ao DOM. Ver
 * `MainActivity.onKeyDown` e `OpenAdVolumeKeyPlugin.kt`.
 *
 * Reaproveita `temporarilyDisableKiosk`, que ja existia para o comando remoto
 * `TEMP_DISABLE_KIOSK`: ele sai do Lock Task, grava o prazo em `Preferences` (para sobreviver
 * a um reinicio dentro da janela) e **reagenda a reentrada** sozinho. Sem essa reentrada um
 * aparelho liberado em campo ficaria liberado para sempre.
 */
@Injectable({ providedIn: 'root' })
export class KioskUnlockGestureService {
  private readonly native = inject(TabletNativeIntegrationService);
  private readonly platformId = inject(PLATFORM_ID);

  private tocando = false;
  private volumeApertado = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handle: PluginListenerHandle | null = null;
  private iniciado = false;

  /** Chamado pelo `APP_INITIALIZER`. Idempotente. */
  async start(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.iniciado) {
      return;
    }
    this.iniciado = true;

    /**
     * `pointerdown`/`pointerup` em vez de `touchstart`/`touchend`: cobre toque e mouse (a
     * depuracao em navegador usa mouse), e `pointercancel` e o que avisa quando o sistema
     * rouba o gesto — sem tratar isso, um toque interrompido deixaria `tocando` preso em
     * `true` e o gesto passaria a exigir so a tecla de volume.
     */
    window.addEventListener('pointerdown', this.aoTocar, { passive: true });
    window.addEventListener('pointerup', this.aoSoltar, { passive: true });
    window.addEventListener('pointercancel', this.aoSoltar, { passive: true });
    // Perder o foco da janela nao emite `pointerup`.
    window.addEventListener('blur', this.aoSoltarTudo);

    if (Capacitor.isPluginAvailable('OpenAdVolumeKey')) {
      try {
        this.handle = await VolumeKey.addListener('volumeDown', (d) => {
          this.volumeApertado = Boolean(d?.pressed);
          this.avaliar();
        });
      } catch {
        // Sem a ponte nativa o gesto nao existe; o comando remoto continua sendo a saida.
      }
    }
  }

  async stop(): Promise<void> {
    window.removeEventListener('pointerdown', this.aoTocar);
    window.removeEventListener('pointerup', this.aoSoltar);
    window.removeEventListener('pointercancel', this.aoSoltar);
    window.removeEventListener('blur', this.aoSoltarTudo);
    this.cancelar();
    try {
      await this.handle?.remove();
    } catch {
      /* ignore */
    }
    this.handle = null;
    this.iniciado = false;
  }

  private readonly aoTocar = (): void => {
    this.tocando = true;
    this.avaliar();
  };

  private readonly aoSoltar = (): void => {
    this.tocando = false;
    this.avaliar();
  };

  private readonly aoSoltarTudo = (): void => {
    this.tocando = false;
    this.volumeApertado = false;
    this.avaliar();
  };

  /** Liga o cronometro quando as duas condicoes valem; desliga quando qualquer uma cai. */
  private avaliar(): void {
    const ambas = this.tocando && this.volumeApertado;
    if (ambas && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.liberar();
      }, SEGURAR_MS);
      return;
    }
    if (!ambas) {
      this.cancelar();
    }
  }

  private cancelar(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async liberar(): Promise<void> {
    try {
      const { disabledUntilIso } =
        await this.native.temporarilyDisableKiosk(LIBERACAO_S);
      console.info(
        JSON.stringify({
          event: 'kiosk.unlocked',
          by: 'gesture',
          until: disabledUntilIso,
        })
      );
    } catch (e: unknown) {
      console.info(
        JSON.stringify({
          event: 'kiosk.unlock.failed',
          detail: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }
}
