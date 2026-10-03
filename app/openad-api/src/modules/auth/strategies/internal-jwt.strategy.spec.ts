import { InternalJwtStrategy } from './internal-jwt.strategy';
import type { UsersService } from '../users.service';

/**
 * O que estes testes protegem: o `JWT_SECRET` e **compartilhado** com o hub e o opendriver,
 * entao a assinatura de um token nao diz nada sobre quem o emitiu. A fronteira do openad e o
 * banco, nao o conteudo do token.
 */
describe('InternalJwtStrategy', () => {
  const SEGREDO_ANTERIOR = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres';
  });

  afterAll(() => {
    process.env.JWT_SECRET = SEGREDO_ANTERIOR;
  });

  function comUsuario(usuario: unknown): InternalJwtStrategy {
    const users = {
      findByUserId: jest.fn().mockResolvedValue(usuario),
    } as unknown as UsersService;
    return new InternalJwtStrategy(users);
  }

  it('toma o papel do banco, ignorando o que o token afirma', async () => {
    const strategy = comUsuario({
      userId: 'u-1',
      email: 'operador@openad.local',
      role: 'fleet_operator',
    });

    // Token forjado alegando o papel mais poderoso que existe aqui.
    const principal = await strategy.validate({
      sub: 'u-1',
      email: 'outro@exemplo.test',
      role: 'super_admin',
    } as never);

    expect(principal).toEqual({
      userId: 'u-1',
      email: 'operador@openad.local',
      role: 'fleet_operator',
      sid: undefined,
      advertiserId: null,
    });
  });

  it('recusa `sub` que nao existe em openad.users, que e o caso do token do hub', async () => {
    const strategy = comUsuario(null);

    // `sub` de um token do hub: e `public.users.id`, nao um `openad.users.userId`.
    const principal = await strategy.validate({
      sub: '9f1c8e40-0000-4000-8000-000000000001',
      role: 'Admin',
    } as never);

    // `null` em vez de excecao: e o que faz o guard tentar a estrategia federada.
    expect(principal).toBeNull();
  });

  it('recusa token sem `sub`', async () => {
    const strategy = comUsuario({ userId: 'u-1', email: 'a@b.c', role: 'super_admin' });
    await expect(strategy.validate({} as never)).resolves.toBeNull();
  });

  it('preserva o `sid` da sessao do portal', async () => {
    const strategy = comUsuario({
      userId: 'u-1',
      email: 'a@b.c',
      role: 'campaign_manager',
    });
    const principal = await strategy.validate({
      sub: 'u-1',
      email: 'a@b.c',
      role: 'campaign_manager',
      sid: 'sessao-123',
    } as never);
    expect(principal?.sid).toBe('sessao-123');
  });
});
