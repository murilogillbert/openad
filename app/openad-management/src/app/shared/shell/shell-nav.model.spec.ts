import { describe, expect, it } from 'vitest';
import { navItemsForRole, SHELL_NAV_ITEMS } from './shell-nav.model';

describe('navItemsForRole', () => {
  function rotulos(role: string | null | undefined): string[] {
    return navItemsForRole(role).map((i) => i.label);
  }

  it('moderador ve o item de moderacao', () => {
    expect(rotulos('content_moderator')).toContain('Moderation');
  });

  it('super_admin tambem ve', () => {
    expect(rotulos('super_admin')).toContain('Moderation');
  });

  it('gerente de campanha nao ve', () => {
    // Nao e seguranca — a API recusa com 403 de qualquer forma. E para nao oferecer no menu
    // uma tela que responderia 403, o que deixa o usuario sem saber se o problema e ele.
    const itens = rotulos('campaign_manager');
    expect(itens).not.toContain('Moderation');
    // E o resto do menu continua inteiro.
    expect(itens).toContain('Campaigns');
    expect(itens).toContain('Reports');
  });

  it('item sem restricao de papel aparece para todos', () => {
    const semPapel = rotulos(null);
    expect(semPapel).toContain('Dashboard');
    expect(semPapel).not.toContain('Moderation');
  });

  it('nenhum item restrito fica sem lista de papeis por descuido', () => {
    // Guarda contra o erro inverso: declarar `roles: []`, que esconderia o item de todo
    // mundo sem erro nenhum aparecer.
    for (const item of SHELL_NAV_ITEMS) {
      if (item.roles) {
        expect(item.roles.length).toBeGreaterThan(0);
      }
    }
  });
});
