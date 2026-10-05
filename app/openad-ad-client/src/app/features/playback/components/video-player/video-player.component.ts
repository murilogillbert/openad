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
 */
@Component({
  selector: 'app-video-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <video
      #video
      class="h-full w-full bg-black object-contain"
      playsinline
      muted
      autoplay
      [src]="src() || undefined"
      (loadeddata)="tocar()"
      (ended)="playbackEnded.emit()"
      (error)="playbackError.emit()"
    ></video>
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
