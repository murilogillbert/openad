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
  /**
   * Papeis que veem este item. Ausente significa "todos os papeis internos".
   *
   * **Isto nao e controle de acesso** — a autorizacao esta nos `@Roles` da API, e um usuario
   * que digite a URL recebe 403 de lá. Serve para nao oferecer no menu uma tela que
   * responderia 403, que e pior do que nao mostrar: o usuario tenta, falha, e nao entende se
   * o problema e ele ou o sistema.
   */
  roles?: readonly string[];
}

/** Papeis que decidem moderacao — espelha `canModerate` no servidor. */
const PAPEIS_DE_MODERACAO = ['content_moderator', 'super_admin'] as const;

/** Filtra o menu pelo papel do usuario. Ver a nota em {@link ShellNavItem.roles}. */
export function navItemsForRole(
  role: string | null | undefined,
  items: readonly ShellNavItem[] = SHELL_NAV_ITEMS
): ShellNavItem[] {
  return items.filter((i) => !i.roles || (role ? i.roles.includes(role) : false));
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
    label: 'Moderation',
    routerLink: ['/moderation'],
    icon: 'gavel',
    linkExact: true,
    roles: PAPEIS_DE_MODERACAO,
  },
  {
    label: 'Reports',
    routerLink: ['/reports'],
    icon: 'bar_chart',
    linkExact: false,
  },
];
