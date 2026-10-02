import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MenuModule } from 'primeng/menu';
import type { MenuItem } from 'primeng/api';
import { PortalAuthService } from '../../../auth/portal-auth.service';
import {
  SHELL_NAV_ITEMS,
  type ShellNavItem,
} from '../shell-nav.model';

@Component({
  selector: 'app-desktop-shell-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MenuModule],
  templateUrl: './desktop-shell-navbar.component.html',
})
export class DesktopShellNavbarComponent {
  readonly auth = inject(PortalAuthService);
  private readonly router = inject(Router);

  readonly navItems = input<ShellNavItem[]>(SHELL_NAV_ITEMS);

  readonly userMenuItems: MenuItem[] = [
    {
      label: 'Settings',
      icon: 'pi pi-cog',
      command: () => void this.router.navigateByUrl('/settings'),
    },
    { separator: true },
    {
      label: 'Log out',
      icon: 'pi pi-sign-out',
      command: () => this.auth.logout(),
    },
  ];

  shellRoleLabel(): string {
    const u = this.auth.getPortalUser();
    if (!u?.role) return 'Operator';
    if (u.role === 'super_admin' || u.role === 'fleet_admin') {
      return 'Administrator';
    }
    return u.role
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  shellDisplayName(): string {
    return this.auth.shellDisplayName();
  }

  linkActiveOptions(item: ShellNavItem): { paths: 'exact' | 'subset' } {
    return item.linkExact === false
      ? { paths: 'subset' }
      : { paths: 'exact' };
  }
}
