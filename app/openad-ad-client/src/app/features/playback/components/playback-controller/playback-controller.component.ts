import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VideoPlayerComponent } from '../video-player/video-player.component';
import { PlaybackEngineService } from '../../services/playback-engine.service';

/**
 * Dual-slot playback: current + hidden preload of {@link PlaybackEngineService.nextSrc} (T081).
 *
 * O elemento vem do `mimeType` do manifesto, nao e fixo. A versao anterior montava um
 * `<video>` para qualquer item; como todo criativo da plataforma e JPEG/PNG, nenhum
 * decodificava e o tablete exibia dois retangulos pretos. Imagem avanca por tempo, no
 * motor, porque `<img>` nao emite `ended`.
 */
@Component({
  selector: 'app-playback-controller',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VideoPlayerComponent],
  template: `
    <div class="relative h-screen w-screen bg-black">
      @if (engine.currentKind() === 'image') {
        <!--
          alt vazio de proposito: o criativo nao tem texto alternativo em lugar nenhum do
          manifesto, e inventar um ("anuncio") seria pior que silencio para leitor de tela.
          A tela e um painel de sinalizacao sem interacao.
        -->
        <img
          class="h-full w-full bg-black object-contain"
          alt=""
          [src]="engine.currentSrc()"
          (error)="onError()"
        />
      } @else {
        <app-video-player
          class="block h-full w-full"
          [src]="engine.currentSrc()"
          (playbackEnded)="onEnded()"
          (playbackError)="onError()"
        />
      }

      @if (engine.nextSrc(); as next) {
        @if (engine.nextKind() === 'image') {
          <img
            class="pointer-events-none absolute h-px w-px opacity-0"
            alt=""
            aria-hidden="true"
            [src]="next"
          />
        } @else {
          <video
            class="pointer-events-none absolute h-px w-px opacity-0"
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
