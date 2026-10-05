import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * HTML5 video element; parent swaps `src` for loop transitions.
 *
 * O `play()` explicito existe porque `autoplay` sozinho nao basta: quando o pai troca
 * apenas o atributo `src` de um elemento ja montado, a WebView nao reavalia o autoplay e o
 * video fica parado no quadro zero — um retangulo preto indistinguivel de falha de
 * download. `muted` e `playsinline` sao o que torna o `play()` programatico permitido sem
 * gesto do usuario, condicao que um tablete em quiosque nunca tem.
 *
 * O dimensionamento esta em CSS proprio, nao em classes utilitarias: **nao ha Tailwind
 * neste projeto** (`src/styles.css` tem so um comentario, e nenhuma dependencia de
 * Tailwind ou PostCSS consta do `package.json`). As classes `h-full w-full` que estavam
 * aqui nunca produziram regra nenhuma, e o `<video>` ficava no tamanho intrinseco de
 * 300x150 — foi dai que vieram os "dois retangulos" no meio da tela.
 */
@Component({
  selector: 'app-video-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <video
      #video
      playsinline
      muted
      autoplay
      [src]="src() || undefined"
      (loadeddata)="tocar()"
      (ended)="playbackEnded.emit()"
      (error)="playbackError.emit()"
    ></video>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    video {
      display: block;
      width: 100%;
      height: 100%;
      /* cover: o criativo cobre a tela inteira, sem tarja preta. Seguro porque a Activity
         esta travada em paisagem e o criativo da plataforma e 16:9 — a proporcao casa e
         nada e recortado. Em retrato isto perderia dois tercos da largura. */
      object-fit: cover;
      background: #000;
    }
  `,
})
export class VideoPlayerComponent {
  readonly src = input<string | null>(null);

  readonly playbackEnded = output<void>();
  readonly playbackError = output<void>();

  private readonly video =
    viewChild<ElementRef<HTMLVideoElement>>('video');

  tocar(): void {
    const el = this.video()?.nativeElement;
    if (!el) {
      return;
    }
    // `play()` rejeita quando a politica de autoplay recusa; o `error` do elemento e quem
    // reporta falha real de midia, entao aqui a rejeicao e so ruido.
    void el.play().catch(() => undefined);
  }
}
