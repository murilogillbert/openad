import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import type { CampaignDocument } from '../campaigns/campaign.schema';
import { canTransition } from '../campaigns/campaign-status.policy';
import {
  MediaAsset,
  MediaAssetDocument,
} from '../media-ingestion/schemas/media-asset.schema';
import { MediaFolderProvisioningService } from '../media-ingestion/media-folder-provisioning.service';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';
import type { PrincipalAnunciante } from './advertiser-principal';
import type { CreateAdvertiserCampaignDto } from './dto/create-advertiser-campaign.dto';
import { validarRepasse } from './driver-payout.policy';

/** Projecao devolvida ao app do anunciante. Nunca inclui campo operacional interno. */
export interface CampanhaDoAnunciante {
  campaignId: string;
  name: string;
  status: string;
  priority: number;
  budget: {
    totalAmountCents: number;
    currency: string;
    ratePerImpressionCents: number;
    dailyBudgetCents: number | null;
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
  moderation: {
    decision: 'approved' | 'rejected';
    reviewedAt: string;
    reason: string | null;
  } | null;
  creativeCount: number;
  scheduledStart: string;
  scheduledEnd: string;
  createdAt: string | null;
  updatedAt: string | null;
}

@Injectable()
export class AdvertiserCampaignsService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly campaigns: CampaignsRepository,
    @InjectModel(MediaAsset.name)
    private readonly media: Model<MediaAssetDocument>,
    private readonly folders: MediaFolderProvisioningService,
    private readonly platform: PlatformConfigRuntimeService
  ) {
    this.logger.setContext(AdvertiserCampaignsService.name);
  }

  /**
   * Cria a campanha em `draft`, **nao** em `pending_review`.
   *
   * O plano original (§4.3) dizia `pending_review` direto. Implementar assim colocaria na
   * fila do moderador uma campanha sem criativo nenhum: ele aprovaria uma casca, e a
   * ativacao falharia depois com um erro sobre regra de agendamento que nada tem a ver com o
   * que ele acabou de decidir. O caminho correto tem dois passos, e a maquina de estados ja
   * previa `draft -> pending_review`: cria em rascunho, sobe o criativo, e `submit()` entrega
   * para revisao depois de verificar que ha algo para revisar.
   */
  async criar(
    dto: CreateAdvertiserCampaignDto,
    anunciante: PrincipalAnunciante
  ): Promise<CampanhaDoAnunciante> {
    const inicio = new Date(dto.scheduledStart);
    const fim = new Date(dto.scheduledEnd);
    if (fim.getTime() <= inicio.getTime()) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_WINDOW',
          message: 'scheduledEnd tem de ser posterior a scheduledStart',
        },
      });
    }

    const repasse = validarRepasse(
      dto.driverPayout,
      dto.budget.ratePerImpressionCents,
      this.platform.get()
    );
    if (repasse.erro) {
      throw new BadRequestException({
        error: { code: repasse.erro.codigo, message: repasse.erro.mensagem },
      });
    }
    const repasseValidado = repasse.repasse;

    const campaignId = randomUUID();
    const doc = await this.campaigns.create({
      campaignId,
      name: dto.name,
      // O nome comercial exibido na frota e o do parceiro, vindo do Postgres — nao um texto
      // livre do cliente. Deixar o app escolher permitiria um parceiro veicular com o nome
      // de outro.
      advertiserName: anunciante.legalName || anunciante.email,
      status: 'draft',
      ownerUserId: anunciante.userId,
      advertiserId: anunciante.advertiserId,
      priority: dto.priority,
      budget: {
        totalAmountCents: dto.budget.totalAmountCents,
        currency: dto.budget.currency,
        ratePerImpressionCents: dto.budget.ratePerImpressionCents,
        dailyBudgetCents: null,
      },
      targeting: {
        cities: dto.targeting?.cities ?? [],
        zoneIds: dto.targeting?.zoneIds ?? [],
        tiers: dto.targeting?.tiers ?? [],
        vehicleTiers: dto.targeting?.vehicleTiers ?? [],
        dayparts: dto.targeting?.dayparts ?? [],
      },
      driverPayout: {
        model: repasseValidado.model,
        percent: repasseValidado.percent,
        valueCents: repasseValidado.valueCents,
      },
      scheduledStart: inicio,
      scheduledEnd: fim,
      createdBy: anunciante.userId,
    });

    await this.folders.ensureCampaignFolderId(campaignId, dto.name);

    this.logger.info(
      {
        event: 'advertiser.campaign.created',
        campaignId,
        advertiserId: anunciante.advertiserId,
        percentEfetivo: repasseValidado.percentEfetivo,
      },
      'campanha de anunciante criada'
    );

    return this.projetar(doc, 0);
  }

  async listar(
    anunciante: PrincipalAnunciante,
    page: number,
    limit: number
  ): Promise<{
    data: CampanhaDoAnunciante[];
    pagination: { total: number; page: number; limit: number };
  }> {
    // O filtro vai na consulta, nao depois dela: escopar em memoria faria a primeira pagina
    // vir vazia por ter sido preenchida com campanha de outro parceiro e descartada.
    const escopo = { ownerUserId: anunciante.userId };
    const total = await this.campaigns.countDocuments(escopo);
    const rows = await this.campaigns.findMany(escopo, {
      skip: (page - 1) * limit,
      limit,
      sort: { updatedAt: -1 },
    });
    const criativos = await this.contarCriativos(
      rows.map((r) => r.campaignId),
      anunciante.userId
    );
    return {
      data: rows.map((r) => this.projetar(r, criativos.get(r.campaignId) ?? 0)),
      pagination: { total, page, limit },
    };
  }

  /**
   * Carrega uma campanha do proprio anunciante.
   *
   * Campanha de outro dono responde **404, nao 403**. "Existe, mas nao e sua" confirma a
   * existencia do identificador e permite enumerar o catalogo alheio; e a mesma decisao
   * tomada nas rotas de midia.
   */
  async obterOuFalhar(
    campaignId: string,
    anunciante: PrincipalAnunciante
  ): Promise<CampaignDocument> {
    const doc = await this.campaigns.findOne({
      campaignId,
      ownerUserId: anunciante.userId,
    });
    if (!doc) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: campaignId },
      });
    }
    return doc;
  }

  async obter(
    campaignId: string,
    anunciante: PrincipalAnunciante
  ): Promise<CampanhaDoAnunciante> {
    const doc = await this.obterOuFalhar(campaignId, anunciante);
    const criativos = await this.contarCriativos(
      [campaignId],
      anunciante.userId
    );
    return this.projetar(doc, criativos.get(campaignId) ?? 0);
  }

  /**
   * Entrega a campanha para revisao humana.
   *
   * Exige ao menos um criativo aprovado e de posse do anunciante. Sem essa guarda, a fila de
   * moderacao recebe cascas vazias — e o custo disso nao e computacional, e o tempo de uma
   * pessoa olhando para uma campanha que nao tem o que olhar.
   */
  async submeter(
    campaignId: string,
    anunciante: PrincipalAnunciante
  ): Promise<CampanhaDoAnunciante> {
    const doc = await this.obterOuFalhar(campaignId, anunciante);

    if (!canTransition(doc.status, 'pending_review')) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_TRANSITION',
          message: `Campanha em ${doc.status} nao pode ir para revisao`,
        },
      });
    }

    const criativos = await this.media.countDocuments({
      campaignId,
      ownerUserId: anunciante.userId,
      isActive: true,
      validationStatus: 'approved',
    });
    if (criativos === 0) {
      throw new BadRequestException({
        error: {
          code: 'NO_CREATIVE',
          message:
            'Suba ao menos um criativo aprovado antes de enviar para revisao',
        },
      });
    }

    const atualizado = await this.campaigns.updateOne(
      { campaignId, ownerUserId: anunciante.userId },
      { $set: { status: 'pending_review' } }
    );
    if (!atualizado) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: campaignId },
      });
    }

    this.logger.info(
      {
        event: 'advertiser.campaign.submitted',
        campaignId,
        advertiserId: anunciante.advertiserId,
        criativos,
      },
      'campanha enviada para moderacao'
    );

    return this.projetar(atualizado, criativos);
  }

  private async contarCriativos(
    campaignIds: string[],
    ownerUserId: string
  ): Promise<Map<string, number>> {
    if (campaignIds.length === 0) {
      return new Map();
    }
    const linhas = (await this.media.aggregate([
      {
        $match: {
          campaignId: { $in: campaignIds },
          ownerUserId,
          isActive: true,
        },
      },
      { $group: { _id: '$campaignId', n: { $sum: 1 } } },
    ])) as Array<{ _id: string; n: number }>;
    return new Map(linhas.map((l) => [l._id, l.n]));
  }

  private projetar(
    doc: CampaignDocument,
    creativeCount: number
  ): CampanhaDoAnunciante {
    const comDatas = doc as CampaignDocument & {
      createdAt?: Date;
      updatedAt?: Date;
    };
    return {
      campaignId: doc.campaignId,
      name: doc.name,
      status: doc.status,
      priority: doc.priority,
      budget: {
        totalAmountCents: doc.budget.totalAmountCents,
        currency: doc.budget.currency,
        ratePerImpressionCents: doc.budget.ratePerImpressionCents,
        dailyBudgetCents: doc.budget.dailyBudgetCents ?? null,
      },
      driverPayout: doc.driverPayout
        ? {
            model: doc.driverPayout.model,
            percent: doc.driverPayout.percent,
            valueCents: doc.driverPayout.valueCents,
          }
        : null,
      targeting: {
        cities: doc.targeting?.cities ?? [],
        zoneIds: doc.targeting?.zoneIds ?? [],
        tiers: doc.targeting?.tiers ?? [],
        vehicleTiers: doc.targeting?.vehicleTiers ?? [],
        dayparts: doc.targeting?.dayparts ?? [],
      },
      // Só a decisao e o motivo. `reviewedByUserId` fica de fora de proposito: o anunciante
      // nao precisa saber qual funcionario recusou o criativo dele, e expor isso convida
      // pressao sobre a pessoa.
      moderation: doc.moderation
        ? {
            decision: doc.moderation.decision,
            reviewedAt: doc.moderation.reviewedAt.toISOString(),
            reason: doc.moderation.reason,
          }
        : null,
      creativeCount,
      scheduledStart: doc.scheduledStart.toISOString(),
      scheduledEnd: doc.scheduledEnd.toISOString(),
      createdAt: comDatas.createdAt?.toISOString() ?? null,
      updatedAt: comDatas.updatedAt?.toISOString() ?? null,
    };
  }
}
