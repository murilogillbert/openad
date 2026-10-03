import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter, map, merge, of } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { DesktopShellNavbarComponent } from '../shell/desktop-shell-navbar/desktop-shell-navbar.component';
import { MobileBottomNavComponent } from '../shell/mobile-bottom-nav/mobile-bottom-nav.component';
import { MobileTopBarComponent } from '../shell/mobile-top-bar/mobile-top-bar.component';
import { MobileTopBarLayoutService } from '../shell/mobile-top-bar-layout.service';
import { navItemsForRole } from '../shell/shell-nav.model';
import { PortalAuthService } from '../../auth/portal-auth.service';
import { PortalFleetNotificationsService } from '../notifications/portal-fleet-notifications.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    NgClass,
    RouterModule,
    DesktopShellNavbarComponent,
    MobileTopBarComponent,
    MobileBottomNavComponent,
  ],
  templateUrl: './main-layout.component.html',
  host: {
    class: 'flex min-h-0 min-w-0 w-full flex-1 flex-col',
  },
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  private readonly auth = inject(PortalAuthService);

  /**
   * Menu filtrado pelo papel. Ver a nota em `ShellNavItem.roles`: isto evita oferecer uma
   * tela que responderia 403, nao substitui a autorizacao, que esta na API.
   *
   * Avaliado uma vez na construcao do layout, que e quando o shell monta — depois do login,
   * entao o papel ja esta em `localStorage`.
   */
  readonly shellNavItems = navItemsForRole(this.auth.getPortalUser()?.role);

  readonly mobileTopLayout = inject(MobileTopBarLayoutService);

  private readonly fleetNotifications = inject(PortalFleetNotificationsService);
  private readonly router = inject(Router);

  /**
   * Fleet map (`/inventory`) is `position:fixed` and reserves bottom inset internally; `main` bottom
   * padding would show as a dead band above the mobile nav.
   */
  readonly isFleetMapRoute = toSignal(
    merge(
      of(null),
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd)
      )
    ).pipe(map(() => this.fleetMapUrl())),
    { initialValue: this.fleetMapUrl() }
  );

  /**
   * Media explorer is full-bleed: no horizontal padding on `main` (child negative margins are
   * unreliable inside flex). See `isFleetMapRoute` for bottom padding exception.
   */
  readonly isMediaRoute = toSignal(
    merge(
      of(null),
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd)
      )
    ).pipe(map(() => this.mediaRouteUrl())),
    { initialValue: this.mediaRouteUrl() }
  );

  private fleetMapUrl(): boolean {
    const p = this.router.url.split('?')[0];
    return p === '/inventory' || p.startsWith('/inventory/');
  }

  private mediaRouteUrl(): boolean {
    const p = this.router.url.split('?')[0];
    return p === '/media' || p.startsWith('/media/');
  }

  ngOnInit(): void {
    this.fleetNotifications.start();
  }

  ngOnDestroy(): void {
    this.fleetNotifications.stop();
  }
}
