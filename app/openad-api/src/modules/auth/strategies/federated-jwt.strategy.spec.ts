import { FederatedJwtStrategy } from './federated-jwt.strategy';
import type { FederatedIdentityService } from '../federated-identity.service';

describe('FederatedJwtStrategy', () => {
  const SEGREDO_ANTERIOR = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres';
  });

  afterAll(() => {
    process.env.JWT_SECRET = SEGREDO_ANTERIOR;
  });

  function comAnunciante(anunciante: unknown): FederatedJwtStrategy {
    const identidade = {
      resolverAnunciante: jest.fn().mockResolvedValue(anunciante),
    } as unknown as FederatedIdentityService;
    return new FederatedJwtStrategy(identidade);
  }

  it('devolve papel `advertiser` mesmo quando o token afirma outro', async () => {
    const strategy = comAnunciante({
      userId: 'pub-1',
      email: 'parceiro@exemplo.test',
      advertiserId: 'adv-1',
      legalName: 'Acme ME',
    });

    // O hub emite `role: 'Admin'` para a propria equipe dele. Isso nao pode conceder nada aqui.
    const principal = await strategy.validate({
      sub: 'pub-1',
      role: 'Admin',
      email: 'parceiro@exemplo.test',
    });

    expect(principal).toEqual({
      userId: 'pub-1',
      email: 'parceiro@exemplo.test',
      role: 'advertiser',
      advertiserId: 'adv-1',
      legalName: 'Acme ME',
    });
  });

  it('recusa quem nao tem linha de anunciante, ainda que o token seja valido', async () => {
    const strategy = comAnunciante(null);
    const principal = await strategy.validate({ sub: 'pub-sem-anuncio', role: 'Driver' });
    expect(principal).toBeNull();
  });

  it('recusa token sem `sub`', async () => {
    const strategy = comAnunciante({
      userId: 'pub-1',
      email: 'a@b.c',
      advertiserId: 'adv-1',
      legalName: 'Acme',
    });
    await expect(strategy.validate({} as never)).resolves.toBeNull();
  });
});
