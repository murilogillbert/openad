import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * HTML5 video element; parent swaps `src` for loop transitions.
 */
@Component({
  selector: 'app-video-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <video
      class="h-full w-full bg-black object-contain"
      playsinline
      muted
      [src]="src() || undefined"
      (ended)="playbackEnded.emit()"
      (error)="playbackError.emit()"
    ></video>
  `,
})
export class VideoPlayerComponent {
  readonly src = input<string | null>(null);

  readonly playbackEnded = output<void>();
  readonly playbackError = output<void>();
}
