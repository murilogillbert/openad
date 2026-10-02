import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VideoPlayerComponent } from '../video-player/video-player.component';
import { PlaybackEngineService } from '../../services/playback-engine.service';

/**
 * Dual-slot playback: current + hidden preload of {@link PlaybackEngineService.nextSrc} (T081).
 */
@Component({
  selector: 'app-playback-controller',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VideoPlayerComponent],
  template: `
    <div class="relative h-screen w-screen bg-black">
      <app-video-player
        class="block h-full w-full"
        [src]="engine.currentSrc()"
        (playbackEnded)="onEnded()"
        (playbackError)="onError()"
      />
      @if (engine.nextSrc(); as next) {
        <video
          class="pointer-events-none absolute h-px w-px opacity-0"
          aria-hidden="true"
          [src]="next"
          preload="auto"
          muted
          playsinline
        ></video>
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
