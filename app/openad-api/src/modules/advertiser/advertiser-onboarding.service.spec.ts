import { ConflictException } from '@nestjs/common';
import { AdvertiserOnboardingService } from './advertiser-onboarding.service';
import type { PrincipalDoEcossistema } from '../auth/strategies/ecosystem-jwt.strategy';

/**
 * O que estes testes travam, e por que cada um importa:
 *
 *  - adesao cria linha `active` (era o que **faltava** no sistema: sem criacao, nenhum
 *    anunciante autenticava, porque `FederatedJwtStrategy` devolve `null` sem a linha);
 *  - repetir a adesao nao cria segunda linha e nao devolve erro (o app repete quando a rede
 *    cai depois do `INSERT`, e a segunda tentativa nao pode travar numa tela de erro com a
 *    conta ja criada);
 *  - anunciante suspenso e recusado, nao reativado (reativar por adesao daria a quem foi
 *    suspenso a forma de desfazer a decisao do operador);
 *  - `legalName` cai para o nome da conta do hub e e cortado em 180 (o limite da coluna).
 */
describe('AdvertiserOnboardingService', () => {
  const principal: PrincipalDoEcossistema = {
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'anunciante@exemplo.com',
    name: 'Padaria do Bairro',
    hubRole: 'Client',
  };

  function montar(linhaExistente: unknown) {
    const adAdvertiser = {
      findUnique: jest.fn().mockResolvedValue(linhaExistente),
      create: jest.fn(),
    };
    // `info` e o nivel que o servico usa (`PinoLogger` nao tem `log`). O mock lista os dois
    // que o codigo chama; acrescentar um `log` que ninguem usa mascararia a troca de nivel.
    const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
    const servico = new AdvertiserOnboardingService(
      logger as never,
      { adAdvertiser } as never
    );
    return { servico, adAdvertiser, logger };
  }

  it('cria o vinculo ativo quando a conta ainda nao e anunciante', async () => {
    const { servico, adAdvertiser } = montar(null);
    adAdvertiser.create.mockResolvedValue({
      id: 'adv-1',
      legalName: 'Padaria do Bairro',
      status: 'active',
      createdAt: new Date('2026-10-03T12:00:00Z'),
    });

    const r = await servico.aderir(principal);

    expect(r.criado).toBe(true);
    expect(r.anunciante).toMatchObject({
      advertiserId: 'adv-1',
      legalName: 'Padaria do Bairro',
      status: 'active',
    });
    expect(adAdvertiser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: principal.userId,
          legalName: 'Padaria do Bairro',
          status: 'active',
        }),
      })
    );
  });

  it('usa o legalName informado em vez do nome da conta', async () => {
    const { servico, adAdvertiser } = montar(null);
    adAdvertiser.create.mockResolvedValue({
      id: 'adv-2',
      legalName: 'Padaria do Bairro LTDA',
      status: 'active',
      createdAt: new Date(),
    });

    await servico.aderir(principal, '  Padaria do Bairro LTDA  ');

    expect(adAdvertiser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ legalName: 'Padaria do Bairro LTDA' }),
      })
    );
  });

  it('corta legalName em 180 caracteres, o limite da coluna', async () => {
    const { servico, adAdvertiser } = montar(null);
    adAdvertiser.create.mockResolvedValue({
      id: 'adv-3',
      legalName: 'x'.repeat(180),
      status: 'active',
      createdAt: new Date(),
    });

    await servico.aderir(principal, 'x'.repeat(400));

    const data = adAdvertiser.create.mock.calls[0][0].data as {
      legalName: string;
    };
    expect(data.legalName).toHaveLength(180);
  });

  it('e idempotente: repetir devolve o existente sem criar de novo', async () => {
    const { servico, adAdvertiser } = montar({
      id: 'adv-ja',
      legalName: 'Padaria do Bairro',
      status: 'active',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });

    const r = await servico.aderir(principal);

    expect(r.criado).toBe(false);
    expect(r.anunciante.advertiserId).toBe('adv-ja');
    expect(adAdvertiser.create).not.toHaveBeenCalled();
  });

  it('recusa anunciante suspenso em vez de reativar', async () => {
    const { servico, adAdvertiser } = montar({
      id: 'adv-susp',
      legalName: 'Suspenso',
      status: 'suspended',
      createdAt: new Date(),
    });

    await expect(servico.aderir(principal)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(adAdvertiser.create).not.toHaveBeenCalled();
  });

  it('situacao devolve null quando a conta nao e anunciante', async () => {
    const { servico } = montar(null);
    await expect(servico.situacao(principal.userId)).resolves.toBeNull();
  });

  it('situacao devolve o vinculo quando existe', async () => {
    const { servico } = montar({
      id: 'adv-9',
      legalName: 'Mercado Central',
      status: 'active',
      createdAt: new Date('2026-09-30T10:00:00Z'),
    });

    await expect(servico.situacao(principal.userId)).resolves.toMatchObject({
      advertiserId: 'adv-9',
      legalName: 'Mercado Central',
      status: 'active',
      createdAt: '2026-09-30T10:00:00.000Z',
    });
  });
});
