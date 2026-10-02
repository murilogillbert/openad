import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { AdPlaybackService } from '../ad-playback.service';
import { PlaybackEngineService } from '../../features/playback/services/playback-engine.service';
import { DeepSleepService } from './deep-sleep.service';

/**
 * Daily 3:00 AM local player restart — defer if ad loop active; skip in Deep Sleep (003 FR-020–021).
 */
@Injectable({ providedIn: 'root' })
export class PlayerRestartScheduler {
  private readonly playback = inject(AdPlaybackService);
  private readonly engine = inject(PlaybackEngineService);
  private readonly deepSleep = inject(DeepSleepService);
  private readonly platformId = inject(PLATFORM_ID);

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFiredKey = '';

  start(): void {
    if (!isPlatformBrowser(this.platformId) || this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => this.check(), 60_000);
  }

  private check(): void {
    const now = new Date();
    if (now.getHours() !== 3 || now.getMinutes() !== 0) {
      return;
    }
    const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (key === this.lastFiredKey) {
      return;
    }
    this.lastFiredKey = key;
    if (this.deepSleep.inDeepSleep()) {
      return;
    }
    // Adia o reinicio quando ha veiculacao em curso. A condicao olhava `activeRule()`, que
    // era a regra do schedule retido e nao dizia nada sobre o que estava na tela.
    if (!this.playback.playbackPaused() && this.engine.adLoopActive()) {
      return;
    }
    // eslint-disable-next-line no-console -- tablet structured log
    console.info(
      JSON.stringify({
        event: 'player.engine_restart',
        trigger: 'schedule_3am',
      })
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
