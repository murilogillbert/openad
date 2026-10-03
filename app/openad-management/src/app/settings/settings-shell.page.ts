import { BreakpointObserver } from '@angular/cdk/layout';
import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, merge, of } from 'rxjs';

type SettingsNavItem = {
  id: 'profile' | 'platform' | 'releases' | 'releaseNotes';
  label: string;
  description: string;
  icon: string;
  routerLink: string;
};

@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
  ],
  templateUrl: './settings-shell.page.html',
  host: {
    class: 'flex min-h-0 min-w-0 w-full flex-1 flex-col',
  },
})
export class SettingsShellPage {
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);

  protected readonly mobile = toSignal(
    this.breakpoints.observe(['(max-width: 768px)']).pipe(map((r) => r.matches)),
    { initialValue: false }
  );

  protected readonly navItems: SettingsNavItem[] = [
    {
      id: 'profile',
      label: 'My profile',
      description: 'Personal details, password, and active sessions.',
      icon: 'pi pi-user',
      routerLink: '/settings/profile',
    },
    {
      id: 'platform',
      label: 'Platform configuration',
      description: 'Fleet-wide thresholds and business rules.',
      icon: 'pi pi-sliders-h',
      routerLink: '/settings/platform',
    },
    {
      id: 'releases',
      label: 'Device app releases',
      description: 'Provisioning QR, APK uploads, and rollouts.',
      icon: 'pi pi-mobile',
      routerLink: '/settings/releases',
    },
    {
      id: 'releaseNotes',
      label: 'App release notes',
      description: 'Read-only build notes for your team.',
      icon: 'pi pi-file-edit',
      routerLink: '/settings/release-notes',
    },
  ];

  private readonly url = toSignal(
    merge(
      of(this.router.url),
      this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(() => this.router.url)
      )
    ),
    { initialValue: this.router.url }
  );

  protected readonly activeItem = computed<SettingsNavItem | null>(() => {
    const u = this.url().split('?')[0] || '/';
    const m = this.navItems.find((i) => u.startsWith(i.routerLink));
    return m ?? null;
  });

  protected readonly showIndex = computed(() => {
    const u = this.url().split('?')[0] || '/';
    return u === '/settings' || u === '/settings/';
  });

  protected readonly mobileTitle = computed(() => this.activeItem()?.label ?? 'Settings');

  protected goBackToIndex(): void {
    void this.router.navigateByUrl('/settings');
  }

  protected open(item: SettingsNavItem): void {
    void this.router.navigateByUrl(item.routerLink);
  }

  constructor() {
    // Desktop UX: /settings should open the first subpage (design expects content + sidenav).
    // Mobile keeps /settings as the settings index list.
    effect(() => {
      if (!this.mobile() && this.showIndex()) {
        void this.router.navigateByUrl('/settings/profile');
      }
    });
  }
}

