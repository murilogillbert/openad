import { FederatedIdentityService } from './federated-identity.service';
import type { PrismaService } from '../../infrastructure/postgres/prisma.service';

describe('FederatedIdentityService', () => {
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  } as unknown as Parameters<typeof construir>[0];

  function construir(
    _logger: unknown,
    anunciante: unknown
  ): FederatedIdentityService {
    const prisma = {
      adAdvertiser: { findUnique: jest.fn().mockResolvedValue(anunciante) },
    } as unknown as PrismaService;
    return new FederatedIdentityService(_logger as never, prisma);
  }

  it('resolve anunciante ativo', async () => {
    const service = construir(logger, {
      id: 'adv-1',
      legalName: 'Acme Publicidade ME',
      status: 'active',
      user: { id: 'pub-1', email: 'parceiro@exemplo.test' },
    });

    await expect(service.resolverAnunciante('pub-1')).resolves.toEqual({
      userId: 'pub-1',
      email: 'parceiro@exemplo.test',
      advertiserId: 'adv-1',
      legalName: 'Acme Publicidade ME',
    });
  });

  it('trata anunciante suspenso como ausente, sem esperar o token expirar', async () => {
    const service = construir(logger, {
      id: 'adv-2',
      legalName: 'Suspensa ME',
      status: 'suspended',
      user: { id: 'pub-2', email: 'suspenso@exemplo.test' },
    });

    await expect(service.resolverAnunciante('pub-2')).resolves.toBeNull();
  });

  it('devolve nulo quando a conta do ecossistema nao e anunciante', async () => {
    const service = construir(logger, null);
    await expect(service.resolverAnunciante('pub-3')).resolves.toBeNull();
  });
});
