import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { AppUpdateService } from './app-update.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Triggers a background update check on a coarse daily cadence (browser timer).
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateSchedulerService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly updates = inject(AppUpdateService);

  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (!isPlatformBrowser(this.platformId) || this.timer) {
      return;
    }
    void this.updates.runUpdateCheckFlow();
    this.timer = setInterval(() => {
      void this.updates.runUpdateCheckFlow();
    }, DAY_MS);
  }
}
