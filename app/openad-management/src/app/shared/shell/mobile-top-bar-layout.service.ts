import { Injectable, signal } from '@angular/core';

/**
 * Mobile header visibility for hide-on-scroll-down; main layout adjusts top padding to match.
 */
@Injectable({ providedIn: 'root' })
export class MobileTopBarLayoutService {
  /** When true, the fixed mobile top bar is fully visible (not translated away). */
  readonly headerVisible = signal(true);

  setHeaderVisible(visible: boolean): void {
    this.headerVisible.set(visible);
  }
}
