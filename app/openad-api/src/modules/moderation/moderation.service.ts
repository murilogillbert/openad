import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { canModerate } from '../auth/access-scope';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { CampaignReadinessService } from '../campaigns/campaign-readiness.service';
import { SchedulePushService } from '../schedule-rules/schedule-push.service';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import {
  MediaAsset,
  MediaAssetDocument,
} from '../media-ingestion/schemas/media-asset.schema';

/** Criativo apresentado ao moderador. Caminho de download e assinado na hora. */
export interface CriativoParaRevisao {
  mediaId: string;
  filename: string;
  mimeType: string | null;
  durationSeconds: number;
  width: number;
  height: number;
  fileSize: number;
  validationStatus: string | null;
}

export interface ItemDaFilaDeModeracao {
  campaignId: string;
  name: string;
  advertiserName: string;
  /** `public.users.id` do dono. Nulo em campanha interna do operador. */
  ownerUserId: string | null;
  advertiserId: string | null;
  priority: number;
  budget: {
    totalAmountCents: number;
    currency: string;
    ratePerImpressionCents: number;
  };
  driverPayout: {
    model: 'percent' | 'per_play';
    percent: number | null;
    valueCents: number | null;
  } | null;
  targeting: {
    cities: string[];
    zoneIds: string[];
    tiers: string[];
    vehicleTiers: string[];
    dayparts: string[];
  };
  scheduledStart: string;
  scheduledEnd: string;
  /** Quando entrou na fila. Ordena a fila: mais antigo primeiro. */
  submittedAt: string | null;
  creatives: CriativoParaRevisao[];
  /**
   * Resultado da verificacao de prontidao, **antes** de o moderador decidir.
   *
   * Sem isto, aprovar uma campanha sem conteudo entregavel devolveria 400 depois do clique,
   * e o moderador nao teria como saber de antemao. A fila diz o que ele vai encontrar.
   */
  readyToActivate: boolean;
  readinessReason: string | null;
  /** Decisao anterior, quando a campanha ja passou pela fila e voltou. */
  previousDecision: {
    decision: 'approved' | 'rejected';
    reviewedAt: string;
    reason: string | null;
  } | null;
}

export type DecisaoDeModeracao = 'approve' | 'reject';

@Injectable()
export class ModerationService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly campaigns: CampaignsRepository,
    private readonly readiness: CampaignReadinessService,
    private readonly schedulePush: SchedulePushService,
    @InjectModel(MediaAsset.name)
    private readonly media: Model<MediaAssetDocument>
  ) {
    this.logger.setContext(ModerationService.name);
  }

  /**
   * Fila de revisao, mais antigo primeiro.
   *
   * A ordem nao e detalhe de apresentacao: numa fila LIFO, a campanha de um anunciante
   * pequeno fica para tras indefinidamente enquanto chegam novas. FIFO e o que torna o tempo
   * de espera limitado e defensavel diante do parceiro.
   */
  async fila(
    page: number,
    limit: number
  ): Promise<{
    data: ItemDaFilaDeModeracao[];
    pagination: { total: number; page: number; limit: number };
  }> {
    const filtro = { status: 'pending_review' };
    const total = await this.campaigns.countDocuments(filtro);
    const rows = await this.campaigns.findMany(filtro, {
      skip: (page - 1) * limit,
      limit,
      sort: { updatedAt: 1 },
    });

    const data: ItemDaFilaDeModeracao[] = [];
    for (const c of rows) {
      const criativos = await this.media
        .find({ campaignId: c.campaignId, isActive: true })
        .select({
          mediaId: 1,
          filename: 1,
          mimeType: 1,
          duration: 1,
          width: 1,
          height: 1,
          fileSize: 1,
          validationStatus: 1,
        })
        .lean()
        .exec();
      const prontidao = await this.readiness.verificar(c.campaignId);
      const comDatas = c as typeof c & { updatedAt?: Date };

      data.push({
        campaignId: c.campaignId,
        name: c.name,
        advertiserName: c.advertiserName,
        ownerUserId: c.ownerUserId,
        advertiserId: c.advertiserId,
        priority: c.priority,
        budget: {
          totalAmountCents: c.budget.totalAmountCents,
          currency: c.budget.currency,
          ratePerImpressionCents: c.budget.ratePerImpressionCents,
        },
        driverPayout: c.driverPayout
          ? {
              model: c.driverPayout.model,
              percent: c.driverPayout.percent,
              valueCents: c.driverPayout.valueCents,
            }
          : null,
        targeting: {
          cities: c.targeting?.cities ?? [],
          zoneIds: c.targeting?.zoneIds ?? [],
          tiers: c.targeting?.tiers ?? [],
          vehicleTiers: c.targeting?.vehicleTiers ?? [],
          dayparts: c.targeting?.dayparts ?? [],
        },
        scheduledStart: c.scheduledStart.toISOString(),
        scheduledEnd: c.scheduledEnd.toISOString(),
        submittedAt: comDatas.updatedAt?.toISOString() ?? null,
        creatives: criativos.map((m) => ({
          mediaId: m.mediaId,
          filename: m.filename,
          mimeType: m.mimeType ?? null,
          durationSeconds: m.duration,
          width: m.width,
          height: m.height,
          fileSize: m.fileSize,
          validationStatus: m.validationStatus ?? null,
        })),
        readyToActivate: prontidao.pronta,
        readinessReason: prontidao.motivo,
        previousDecision: c.moderation
          ? {
              decision: c.moderation.decision,
              reviewedAt: c.moderation.reviewedAt.toISOString(),
              reason: c.moderation.reason,
            }
          : null,
      });
    }

    return { data, pagination: { total, page, limit } };
  }

  /**
   * Aprova ou recusa, registrando quem decidiu.
   *
   * Rota propria em vez de `PATCH /campaigns/:id/status` porque sao operacoes diferentes com
   * a mesma mecanica: moderar e um ato auditado, com motivo obrigatorio na recusa e papel
   * exclusivo, enquanto mudar status e operacao de rotina do gerente (pausar, concluir). A
   * rota generica continua aceitando a transicao — a politica e a mesma — mas a tela de
   * moderacao fala com um verbo que diz o que esta acontecendo.
   */
  async decidir(params: {
    campaignId: string;
    decisao: DecisaoDeModeracao;
    motivo: string | null;
    ator: { userId: string | null; role: string | undefined };
    audit: FleetAuditContext;
  }): Promise<{ campaignId: string; status: string }> {
    const { campaignId, decisao, motivo, ator, audit } = params;

    if (!canModerate(ator.role)) {
      throw new ForbiddenException({
        error: {
          code: 'MODERATION_FORBIDDEN',
          message: 'Somente moderador de conteudo ou super_admin decide moderacao',
        },
      });
    }

    const campanha = await this.campaigns.findByCampaignId(campaignId);
    if (!campanha) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: campaignId },
      });
    }

    /**
     * So campanha em revisao e decidivel.
     *
     * A guarda importa porque a fila e paginada e a tela, por natureza, mostra um retrato
     * de alguns segundos atras: dois moderadores podem abrir o mesmo item, e sem isto o
     * segundo clique sobrescreveria a decisao do primeiro — inclusive revertendo uma recusa
     * para aprovacao sem que ninguem visse.
     */
    if (campanha.status !== 'pending_review') {
      throw new BadRequestException({
        error: {
          code: 'NOT_IN_REVIEW',
          message:
            `A campanha esta em ${campanha.status}, nao em revisao. ` +
            'Ela pode ter sido decidida por outro moderador.',
        },
      });
    }

    if (decisao === 'reject') {
      const texto = (motivo ?? '').trim();
      if (texto.length === 0) {
        throw new BadRequestException({
          error: {
            code: 'REASON_REQUIRED',
            message: 'Recusa exige motivo, para o anunciante saber o que corrigir',
          },
        });
      }
      await this.gravar(campaignId, 'rejected', {
        decision: 'rejected',
        reason: texto,
        ator,
      });
      this.logger.info(
        {
          ...audit,
          event: 'moderation.rejected',
          campaignId,
          reviewedByUserId: ator.userId,
        },
        'campanha recusada na moderacao'
      );
      return { campaignId, status: 'rejected' };
    }

    const prontidao = await this.readiness.verificar(campaignId);
    if (!prontidao.pronta) {
      throw new BadRequestException({
        error: {
          code: 'NOT_READY_TO_ACTIVATE',
          message: prontidao.motivo ?? 'Campanha sem conteudo entregavel',
        },
      });
    }

    await this.gravar(campaignId, 'active', {
      decision: 'approved',
      reason: motivo?.trim() ? motivo.trim() : null,
      ator,
    });

    /**
     * Empurra o `schedule` por MQTT so quando a entrega e pela geracao 1.
     *
     * Campanha de anunciante entrega pelo manifesto (`POST /manifest`), que o tablete puxa;
     * nao ha regra de agendamento para publicar, e chamar o push produziria um `schedule`
     * retido vazio — que o player trataria como "nada a tocar" e sobrescreveria o schedule
     * valido de outra campanha.
     */
    if (prontidao.via === 'schedule_rules') {
      await this.schedulePush.pushForCampaign(campaignId, audit);
    }

    this.logger.info(
      {
        ...audit,
        event: 'moderation.approved',
        campaignId,
        reviewedByUserId: ator.userId,
        via: prontidao.via,
      },
      'campanha aprovada na moderacao'
    );
    return { campaignId, status: 'active' };
  }

  private async gravar(
    campaignId: string,
    status: 'active' | 'rejected',
    dados: {
      decision: 'approved' | 'rejected';
      reason: string | null;
      ator: { userId: string | null; role: string | undefined };
    }
  ): Promise<void> {
    /**
     * A atualizacao e condicionada a `status: 'pending_review'` tambem aqui, e nao so na
     * verificacao acima: entre ler e escrever ha chamadas de rede, e e nessa janela que dois
     * moderadores decidindo ao mesmo tempo se atropelariam. Como `findOneAndUpdate` e atomico
     * no servidor do Mongo, o segundo nao encontra documento e recebe o erro de concorrencia.
     */
    const atualizado = await this.campaigns.updateOne(
      { campaignId, status: 'pending_review' },
      {
        $set: {
          status,
          moderation: {
            reviewedByUserId: dados.ator.userId ?? 'unknown',
            reviewedAt: new Date(),
            decision: dados.decision,
            reason: dados.reason,
          },
        },
      }
    );
    if (!atualizado) {
      throw new BadRequestException({
        error: {
          code: 'NOT_IN_REVIEW',
          message:
            'A campanha deixou de estar em revisao enquanto a decisao era gravada',
        },
      });
    }
  }
}
