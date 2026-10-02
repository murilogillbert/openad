import { Component, HostListener, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { PortalAuthService } from '../../../auth/portal-auth.service';
import { MobileTopBarLayoutService } from '../mobile-top-bar-layout.service';

@Component({
  selector: 'app-mobile-top-bar',
  standalone: true,
  imports: [RouterLink, ButtonModule, DialogModule],
  templateUrl: './mobile-top-bar.component.html',
})
export class MobileTopBarComponent {
  readonly auth = inject(PortalAuthService);
  readonly topBarLayout = inject(MobileTopBarLayoutService);

  readonly profileDialogVisible = signal(false);

  private lastScrollY = 0;
  private readonly scrollThreshold = 8;

  @HostListener('window:scroll', [])
  onWindowScroll(): void {
    const y =
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;
    const delta = y - this.lastScrollY;

    if (y < this.scrollThreshold) {
      this.topBarLayout.setHeaderVisible(true);
    } else if (delta > 6) {
      this.topBarLayout.setHeaderVisible(false);
    } else if (delta < -6) {
      this.topBarLayout.setHeaderVisible(true);
    }

    this.lastScrollY = y;
  }

  openProfileMenu(): void {
    this.topBarLayout.setHeaderVisible(true);
    this.profileDialogVisible.set(true);
  }

  closeProfileMenu(): void {
    this.profileDialogVisible.set(false);
  }

  logout(): void {
    this.profileDialogVisible.set(false);
    this.auth.logout();
  }
}
