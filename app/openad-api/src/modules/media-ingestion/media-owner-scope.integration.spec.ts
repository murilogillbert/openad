import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Model } from 'mongoose';
import { ownerFilterFor } from '../auth/access-scope';
import { MediaAsset } from './schemas/media-asset.schema';
import { MediaIngestionService } from './media-ingestion.service';
import {
  createTestApp,
  shutdownTestApp,
  type TestAppContext,
} from '../../test/test-app.factory';

/**
 * Isolamento de midia entre anunciantes, afirmado contra o banco.
 *
 * `access-scope.spec.ts` ja prova que `ownerFilterFor` devolve o filtro certo. O que **nao**
 * estava provado e que o filtro chega a consulta: ele podia estar correto e nao ser aplicado,
 * que foi exatamente o defeito D5 original — a regra existia num servico que ninguem chamava.
 *
 * Por isso este teste exercita o servico real contra o Mongo, com dois donos e um ativo sem
 * dono, em vez de verificar a funcao pura de novo.
 */
describe('escopo de dono na midia (integration)', () => {
  let ctx: TestAppContext;
  let service: MediaIngestionService;
  let model: Model<MediaAsset>;

  const DONO_A = 'pub-aaaa-0001';
  const DONO_B = 'pub-bbbb-0002';

  const filtroDe = (userId: string | null, role: string) =>
    ownerFilterFor({ userId, role });

  async function semearAtivo(ownerUserId: string | null): Promise<string> {
    const mediaId = randomUUID();
    await model.create({
      mediaId,
      hash: randomUUID().replace(/-/g, ''),
      filename: `${mediaId}.mp4`,
      fileSize: 1024,
      bitrate: 2_000_000,
      width: 1920,
      height: 1080,
      codec: 'h264',
      duration: 15,
      categorization: 'universal',
      storageUrl: `s3://test/${mediaId}`,
      ownerUserId,
      isActive: true,
    });
    return mediaId;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    service = ctx.app.get(MediaIngestionService);
    model = ctx.app.get<Model<MediaAsset>>(getModelToken(MediaAsset.name));
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 60_000);

  it('cada anunciante lista somente a propria midia, e o total acompanha', async () => {
    const doA = await semearAtivo(DONO_A);
    await semearAtivo(DONO_A);
    const doB = await semearAtivo(DONO_B);

    const listaA = await service.listCatalog({
      page: 1,
      limit: 50,
      scope: filtroDe(DONO_A, 'advertiser'),
    });
    const listaB = await service.listCatalog({
      page: 1,
      limit: 50,
      scope: filtroDe(DONO_B, 'advertiser'),
    });

    expect(listaA.data).toHaveLength(2);
    expect(listaA.pagination.total).toBe(2);
    expect(listaA.data.map((m) => m.mediaId)).toContain(doA);
    expect(listaA.data.map((m) => m.mediaId)).not.toContain(doB);

    expect(listaB.data).toHaveLength(1);
    // O total tem de ser o do escopo, nao o da plataforma: paginacao com total alheio
    // produziria paginas vazias no fim da lista.
    expect(listaB.pagination.total).toBe(1);
  });

  it('equipe interna ve tudo, inclusive midia sem dono', async () => {
    await semearAtivo(DONO_A);
    await semearAtivo(null);

    const interna = await service.listCatalog({
      page: 1,
      limit: 50,
      scope: filtroDe('operador-1', 'fleet_admin'),
    });

    expect(interna.pagination.total).toBeGreaterThanOrEqual(2);
    expect(interna.data.some((m) => m.ownerUserId === null)).toBe(true);
  });

  it('ativo de outro parceiro responde 404, e nao 403', async () => {
    const doB = await semearAtivo(DONO_B);

    // 404 e deliberado: "existe, mas nao e seu" revelaria o ativo alheio e permitiria
    // enumerar o catalogo com identificadores adivinhados.
    await expect(
      service.getById(doB, filtroDe(DONO_A, 'advertiser'))
    ).rejects.toBeInstanceOf(NotFoundException);

    // E o dono continua lendo normalmente.
    await expect(
      service.getById(doB, filtroDe(DONO_B, 'advertiser'))
    ).resolves.toMatchObject({ mediaId: doB });
  });

  it('nao e possivel excluir midia de outro parceiro', async () => {
    const doB = await semearAtivo(DONO_B);

    await expect(
      service.softDelete(doB, filtroDe(DONO_A, 'advertiser'))
    ).rejects.toBeInstanceOf(NotFoundException);

    // Continua ativa: a tentativa falhou sem efeito colateral.
    const ainda = await model.findOne({ mediaId: doB }).lean().exec();
    expect(ainda?.isActive).toBe(true);

    // O dono exclui.
    await service.softDelete(doB, filtroDe(DONO_B, 'advertiser'));
    const depois = await model.findOne({ mediaId: doB }).lean().exec();
    expect(depois?.isActive).toBe(false);
  });

  it('anunciante sem identidade nao alcanca midia nenhuma', async () => {
    await semearAtivo(DONO_A);

    const lista = await service.listCatalog({
      page: 1,
      limit: 50,
      scope: filtroDe(null, 'advertiser'),
    });

    expect(lista.data).toHaveLength(0);
    expect(lista.pagination.total).toBe(0);
  });
});
