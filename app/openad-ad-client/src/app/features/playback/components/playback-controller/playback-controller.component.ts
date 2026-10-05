import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VideoPlayerComponent } from '../video-player/video-player.component';
import { PlaybackEngineService } from '../../services/playback-engine.service';

/**
 * Dual-slot playback: current + hidden preload of {@link PlaybackEngineService.nextSrc} (T081).
 *
 * Duas correcoes de causas independentes que produziam o mesmo sintoma — "dois retangulos
 * no meio da tela, sem criativo":
 *
 * 1. **O elemento vem do `mimeType` do manifesto**, nao e fixo. A versao anterior montava
 *    um `<video>` para qualquer item; como todo criativo da plataforma e JPEG/PNG, nenhum
 *    decodificava. Imagem avanca por tempo, no motor, porque `<img>` nao emite `ended`.
 *
 * 2. **O layout esta em CSS proprio, nao em classes Tailwind.** Nao ha Tailwind no
 *    projeto: `src/styles.css` tem apenas um comentario e nenhuma dependencia de Tailwind
 *    ou PostCSS consta do `package.json`. `h-screen w-screen`, `absolute`, `h-px w-px` e
 *    `opacity-0` nunca geraram regra alguma — por isso o criativo atual e o de precarga
 *    apareciam **os dois**, no tamanho natural, empilhados no fluxo da pagina.
 *
 * `position: fixed` no palco, e nao `100vw/100vh` em elemento no fluxo, para que margem do
 * `body` ou barra de rolagem nao desloquem nem recortem a area de veiculacao.
 */
@Component({
  selector: 'app-playback-controller',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VideoPlayerComponent],
  template: `
    <div class="palco">
      @if (engine.currentKind() === 'image') {
        <!--
          alt vazio de proposito: o criativo nao tem texto alternativo em lugar nenhum do
          manifesto, e inventar um ("anuncio") seria pior que silencio para leitor de tela.
          A tela e um painel de sinalizacao sem interacao.
        -->
        <img
          class="atual"
          alt=""
          [src]="engine.currentSrc()"
          (error)="onError()"
        />
      } @else {
        <app-video-player
          class="atual"
          [src]="engine.currentSrc()"
          (playbackEnded)="onEnded()"
          (playbackError)="onError()"
        />
      }

      @if (engine.nextSrc(); as next) {
        @if (engine.nextKind() === 'image') {
          <img class="precarga" alt="" aria-hidden="true" [src]="next" />
        } @else {
          <video
            class="precarga"
            aria-hidden="true"
            [src]="next"
            preload="auto"
            muted
            playsinline
          ></video>
        }
      }
    </div>
  `,
  styles: `
    .palco {
      position: fixed;
      inset: 0;
      background: #000;
      overflow: hidden;
    }

    .atual {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
      /* cover, nao contain: a Activity esta travada em paisagem e o criativo e 16:9, entao
         cobrir a tela nao corta nada. Ver AndroidManifest.xml. */
      object-fit: cover;
      background: #000;
    }

    /*
      Precarga fora de vista, mas ainda renderizada: display:none desobriga a WebView de
      buscar os bytes, e o objetivo aqui e exatamente que ela busque antes da troca. 1px com
      opacidade zero mantem o elemento no layout sem aparecer.
    */
    .precarga {
      position: absolute;
      left: 0;
      top: 0;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
  `,
})
export class PlaybackControllerComponent {
  readonly engine = inject(PlaybackEngineService);

  async onEnded(): Promise<void> {
    await this.engine.advance();
  }

  async onError(): Promise<void> {
    await this.engine.onPlaybackError();
  }
}
