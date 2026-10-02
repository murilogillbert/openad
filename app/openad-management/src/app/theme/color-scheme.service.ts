import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

const STORAGE_KEY = 'openad-color-scheme';

export type ColorSchemePreference = 'light' | 'dark';

/**
 * Light theme only until dark palette is finalized. Keeps `<html>` out of `.dark`
 * and ignores persisted / system preference for dark.
 */
@Injectable({ providedIn: 'root' })
export class ColorSchemeService {
  private readonly platformId = inject(PLATFORM_ID);

  /** Always false while dark theme is disabled. */
  readonly isDark = signal(false);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    document.documentElement.classList.remove('dark');
    try {
      localStorage.setItem(STORAGE_KEY, 'light');
    } catch {
      /* ignore */
    }
  }

  /**
   * Previously: `localStorage` or `prefers-color-scheme`. Reserved for when dark returns.
   */
  static resolveInitialIsDark(): boolean {
    return false;
  }

  toggle(): void {
    /* dark theme disabled */
  }

  setDark(_dark: boolean): void {
    /* dark theme disabled */
  }
}
