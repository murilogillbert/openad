import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/postgres/prisma.service';
import { Campaign, CampaignDocument } from '../campaigns/campaign.schema';
import {
  MediaAsset,
  MediaAssetDocument,
} from '../media-ingestion/schemas/media-asset.schema';

/**
 * Exclusão de conta no openad, do lado passivo do fan-out do hub.
 *
 * Isto é LGPD, não refinamento. Antes desta leva o `accountSync.ts` do hub conhecia **só** o
 * opendriver: apagar uma conta no hub deixava campanha, criativo e livro de crédito do
 * anunciante vivos aqui, com `ownerUserId` apontando para um usuário que o titular pediu
 * para remover.
 *
 * As duas operações seguem o contrato que o hub já usa com o opendriver, porque é o que o
 * `accountSync.ts` sabe falar:
 *
 *   GET  /internal/accounts/:id/deletion-blockers  ->  { data: { blockers: string[] } }
 *   POST /internal/accounts/:id/purge              ->  204
 *
 * As duas são **idempotentes**. O hub chama em sequência e só purga o lado dele por último,
 * de modo que uma falha no meio deixa a conta viva e a operação repetível.
 */
@Injectable()
export class AccountPurgeService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    @InjectModel(Campaign.name)
    private readonly campaigns: Model<CampaignDocument>,
    @InjectModel(MediaAsset.name)
    private readonly media: Model<MediaAssetDocument>
  ) {
    this.logger.setContext(AccountPurgeService.name);
  }

  /**
   * O que impede excluir a conta agora.
   *
   * Dois impedimentos, e cada um existe por um motivo diferente:
   *
   * 1. **Campanha no ar.** Enquanto ela veicula, há mídia sendo tocada na frota e play
   *    records chegando. Anonimizar o dono no meio disso produziria faturamento órfão — a
   *    veiculação é faturável e o anunciante some. Pausar primeiro é decisão do titular.
   * 2. **Crédito não consumido.** Saldo positivo é dinheiro que a pessoa pagou e não gastou.
   *    Apagar a conta sem resolver isso é confisco silencioso. O crédito não é sacável (é a
   *    razão de `ad_credit_ledger` existir separado do cashback), então a resolução é
   *    consumir ou estornar pela loja — e nenhuma das duas o openad decide sozinho.
   *
   * Mensagens em português e na primeira pessoa do titular, porque o hub concatena os
   * blockers de todos os serviços num único texto mostrado ao usuário.
   */
  async blockers(userId: string): Promise<string[]> {
    const bloqueios: string[] = [];

    const noAr = await this.campaigns.countDocuments({
      ownerUserId: userId,
      status: { $in: ['active', 'pending_review'] },
    });
    if (noAr > 0) {
      bloqueios.push(
        noAr === 1
          ? 'Você tem 1 campanha ativa ou em revisão no OpenAd.'
          : `Você tem ${noAr} campanhas ativas ou em revisão no OpenAd.`
      );
    }

    const saldo = await this.saldoDeCredito(userId);
    if (saldo > 0) {
      bloqueios.push(
        `Você tem ${(saldo / 100).toFixed(2)} em crédito de veiculação não consumido no OpenAd.`
      );
    }

    return bloqueios;
  }

  /**
   * Anonimiza e desativa, **sem apagar** registro de faturamento.
   *
   * A mesma escolha que o opendriver faz com corrida e livro-caixa: `ad_credit_purchases` e
   * `ad_credit_ledger` são registro fiscal de dinheiro que entrou e foi consumido, e o
   * titular pedir exclusão não desobriga a plataforma de prestar contas daquilo. O que sai é
   * o que identifica a pessoa; o que fica é o valor, sem nome colado nele.
   *
   * `impression_events` e `play_records` também ficam: são o lastro do que já foi pago ao
   * motorista, e eles referenciam campanha, não pessoa.
   */
  async purge(userId: string): Promise<void> {
    const anunciante = await this.prisma.adAdvertiser.findUnique({
      where: { userId },
      select: { id: true },
    });

    // Campanha e mídia são escopadas por `ownerUserId`, que existe mesmo sem linha de
    // anunciante (campanha criada antes da federação). Então elas são tratadas sempre.
    const campanhas = await this.campaigns.updateMany(
      { ownerUserId: userId, status: { $nin: ['archived'] } },
      { $set: { status: 'archived' } }
    );

    const midias = await this.media.updateMany(
      { ownerUserId: userId, isActive: true },
      { $set: { isActive: false } }
    );

    if (anunciante) {
      /**
       * `suspended` em vez de apagar a linha: a FK de `ad_credit_purchases` e
       * `ad_credit_ledger` para `ad_advertisers` é `onDelete: Restrict`, de propósito. Apagar
       * exigiria apagar o registro de dinheiro junto, que é exatamente o que não se deve
       * fazer.
       *
       * `legal_name` recebe o texto fixo e o documento sai. Com `status = suspended`, a
       * `FederatedIdentityService` passa a tratar o token como ausente, então a sessão morre
       * na próxima requisição em vez de esperar o token expirar.
       */
      await this.prisma.adAdvertiser.update({
        where: { id: anunciante.id },
        data: {
          legalName: 'Conta excluída',
          documentEnc: null,
          documentHash: null,
          status: 'suspended',
        },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: null,
        action: 'openad.account.purged',
        entityType: 'AdAdvertiser',
        entityId: anunciante?.id ?? userId,
        payloadJson: JSON.stringify({
          userId,
          campanhasArquivadas: campanhas.modifiedCount,
          midiasDesativadas: midias.modifiedCount,
          tinhaLinhaDeAnunciante: Boolean(anunciante),
        }),
      },
    });

    this.logger.info(
      {
        event: 'internal.account.purged',
        userId,
        campanhasArquivadas: campanhas.modifiedCount,
        midiasDesativadas: midias.modifiedCount,
      },
      'conta de anunciante purgada no openad'
    );
  }

  /** Saldo de crédito em centavos: soma dos lançamentos, como todo livro append-only. */
  private async saldoDeCredito(userId: string): Promise<number> {
    const anunciante = await this.prisma.adAdvertiser.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!anunciante) {
      return 0;
    }
    const linhas = await this.prisma.adCreditLedger.groupBy({
      by: ['direction'],
      where: { advertiserId: anunciante.id },
      _sum: { amountCents: true },
    });
    let saldo = 0;
    for (const l of linhas) {
      const v = l._sum.amountCents ?? 0;
      saldo += l.direction === 'credit' ? v : -v;
    }
    return saldo;
  }
}
