import { NgClass } from '@angular/common';
import { Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  SHELL_NAV_ITEMS,
  type ShellNavItem,
} from '../shell-nav.model';

@Component({
  selector: 'app-mobile-bottom-nav',
  standalone: true,
  imports: [NgClass, RouterLink, RouterLinkActive],
  templateUrl: './mobile-bottom-nav.component.html',
})
export class MobileBottomNavComponent {
  readonly navItems = input<ShellNavItem[]>(SHELL_NAV_ITEMS);

  linkActiveOptions(item: ShellNavItem): { paths: 'exact' | 'subset' } {
    return item.linkExact === false
      ? { paths: 'subset' }
      : { paths: 'exact' };
  }
}
