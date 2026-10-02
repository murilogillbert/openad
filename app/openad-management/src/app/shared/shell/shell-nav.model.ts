/** Shell navigation — aligned with design (desktop standalone + mobile bottom bar). */
export interface ShellNavItem {
  label: string;
  routerLink: string[];
  /** Material Symbols ligature name */
  icon: string;
  /**
   * When false, active state matches child routes (e.g. /campaigns/:id).
   * When true or omitted, only exact path matches.
   */
  linkExact?: boolean;
}

/** Primary shell — design: Dashboard, Live Fleet, Devices, Campaigns, Media, Reports */
export const SHELL_NAV_ITEMS: ShellNavItem[] = [
  { label: 'Dashboard', routerLink: ['/dashboard'], icon: 'dashboard', linkExact: true },
  {
    label: 'Live Fleet',
    routerLink: ['/inventory'],
    icon: 'airport_shuttle',
    linkExact: true,
  },
  {
    label: 'Devices',
    routerLink: ['/devices'],
    icon: 'devices',
    linkExact: false,
  },
  {
    label: 'Campaigns',
    routerLink: ['/campaigns'],
    icon: 'campaign',
    linkExact: false,
  },
  {
    label: 'Media',
    routerLink: ['/media'],
    icon: 'perm_media',
    linkExact: true,
  },
  {
    label: 'Reports',
    routerLink: ['/reports'],
    icon: 'bar_chart',
    linkExact: false,
  },
];
