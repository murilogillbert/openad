import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  allowedTransitionsFrom,
  canTransition,
  moderationReasonRequired,
  requiresModeration,
} from './campaign-status.policy';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { ScheduleRulesRepository } from '../schedule-rules/schedule-rules.repository';
import { CreativeAssetsRepository } from './creative-assets.repository';
import { CampaignsRepository } from './campaigns.repository';
import type { CreateCampaignDto } from './dto/create-campaign.dto';
import type { PatchCampaignStatusDto } from './dto/patch-campaign-status.dto';
import { SchedulePushService } from '../schedule-rules/schedule-push.service';
import { MediaFolderProvisioningService } from '../media-ingestion/media-folder-provisioning.service';

@Injectable()
export class CampaignLifecycleService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly campaigns: CampaignsRepository,
    private readonly assets: CreativeAssetsRepository,
    private readonly rules: ScheduleRulesRepository,
    private readonly schedulePush: SchedulePushService,
    private readonly mediaFolders: MediaFolderProvisioningService
  ) {
    this.logger.setContext(CampaignLifecycleService.name);
  }

  /**
   * Lista campanhas, **sempre** escopada.
   *
   * `scope` vem de `ownerFilterFor` (`auth/access-scope`): `{}` para equipe interna e
   * `{ ownerUserId }` para anunciante. Antes era `findMany({})` — toda campanha de todo
   * mundo — e o filtro precisa estar na consulta, nao depois: escopar em memoria faria a
   * primeira pagina de um parceiro vir vazia porque foi preenchida com registros de outro
   * e descartada.
   */
  async list(
    page = 1,
    limit = 50,
    audit?: FleetAuditContext,
    scope: Record<string, unknown> = {}
  ) {
    if (audit) {
      this.logger.info(
        { ...audit, event: 'campaign.list', page, limit, scoped: Object.keys(scope).length > 0 },
        'list campaigns'
      );
    }
    const skip = (page - 1) * limit;
    const total = await this.campaigns.countDocuments(scope);
    const rows = await this.campaigns.findMany(
      scope,
      { skip, limit, sort: { updatedAt: -1 } }
    );
    return {
      data: rows.map((d) => this.serialize(d)),
      pagination: { total, page, limit },
    };
  }

  async create(dto: CreateCampaignDto, audit: FleetAuditContext, createdBy: string | null) {
    const campaignId = randomUUID();
    this.logger.info(
      { ...audit, event: 'campaign.create.attempt', campaignId },
      'create campaign'
    );

    const doc = await this.campaigns.create({
      campaignId,
      name: dto.name,
      advertiserName: dto.advertiserName,
      status: 'draft',
      // Campanha criada pelo operador nasce sem dono; a do anunciante recebe
      // `ownerUserId` nas rotas de `/advertiser`, que entram junto com a identidade
      // federada.
      ownerUserId: null,
      priority: dto.priority,
      // `dailyBudgetCents` e opcional no DTO e sempre presente no documento: normalizar aqui
      // evita que `undefined` chegue ao Mongoose, que grava o campo ausente em vez do `null`
      // que o pacing espera ler.
      budget: {
        totalAmountCents: dto.budget.totalAmountCents,
        currency: dto.budget.currency,
        ratePerImpressionCents: dto.budget.ratePerImpressionCents,
        dailyBudgetCents: dto.budget.dailyBudgetCents ?? null,
      },
      scheduledStart: new Date(dto.scheduledStart),
      scheduledEnd: new Date(dto.scheduledEnd),
      createdBy,
    });

    this.logger.info(
      { ...audit, event: 'campaign.create.success', campaignId },
      'campaign created'
    );

    await this.mediaFolders.ensureCampaignFolder(campaignId, dto.name);

    return this.serialize(doc);
  }

  async patchStatus(
    campaignId: string,
    body: PatchCampaignStatusDto,
    audit: FleetAuditContext,
    actor?: { userId: string | null; role: string | undefined }
  ) {
    const campaign = await this.campaigns.findByCampaignId(campaignId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    this.logger.info(
      {
        ...audit,
        event: 'campaign.status.attempt',
        campaignId,
        fromStatus: campaign.status,
        nextStatus: body.status,
      },
      'campaign status change'
    );

    if (campaign.status !== body.status) {
      if (!canTransition(campaign.status, body.status)) {
        throw new BadRequestException(
          `Transicao invalida: ${campaign.status} -> ${body.status}. ` +
            `Permitidas: ${allowedTransitionsFrom(campaign.status).join(', ') || 'nenhuma'}`
        );
      }

      if (requiresModeration(campaign.status, body.status)) {
        const role = actor?.role;
        if (role !== 'content_moderator' && role !== 'super_admin') {
          throw new ForbiddenException(
            'Somente moderador pode aprovar ou recusar campanha'
          );
        }
        if (moderationReasonRequired(body.status) && !body.reason) {
          throw new BadRequestException(
            'Recusa exige motivo, para o anunciante saber o que corrigir'
          );
        }
      }
    }

    if (body.status === 'active') {
      const activeRules = await this.rules.findActiveByCampaignId(campaignId);
      if (activeRules.length === 0) {
        throw new BadRequestException(
          'Campaign must have at least one active schedule rule before activation'
        );
      }
      for (const r of activeRules) {
        const asset = await this.assets.findByAssetId(r.assetId);
        if (!asset || asset.status !== 'verified') {
          throw new BadRequestException(
            'All schedule rules must reference verified assets before activation'
          );
        }
      }
    }

    const patch: Record<string, unknown> = { status: body.status };
    if (requiresModeration(campaign.status, body.status)) {
      patch['moderation'] = {
        reviewedByUserId: actor?.userId ?? 'unknown',
        reviewedAt: new Date(),
        decision: body.status === 'active' ? 'approved' : 'rejected',
        reason: body.reason ?? null,
      };
    }

    const updated = await this.campaigns.updateOne(
      { campaignId },
      { $set: patch }
    );
    if (!updated) {
      throw new NotFoundException('Campaign not found');
    }

    const next = await this.campaigns.findByCampaignId(campaignId);
    if (!next) {
      throw new NotFoundException('Campaign not found');
    }
    if (body.status === 'active') {
      await this.schedulePush.pushForCampaign(campaignId, audit);
    }

    this.logger.info(
      {
        ...audit,
        event: 'campaign.status.success',
        campaignId,
        status: body.status,
      },
      'campaign status updated'
    );

    return this.serialize(next);
  }

  private serialize(doc: {
    campaignId: string;
    name: string;
    advertiserName: string;
    status: string;
    priority: number;
    budget: {
      totalAmountCents: number;
      currency: string;
      ratePerImpressionCents: number;
      dailyBudgetCents?: number | null;
    };
    scheduledStart: Date;
    scheduledEnd: Date;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      campaignId: doc.campaignId,
      name: doc.name,
      advertiserName: doc.advertiserName,
      status: doc.status,
      priority: doc.priority,
      budget: doc.budget,
      scheduledStart: doc.scheduledStart.toISOString(),
      scheduledEnd: doc.scheduledEnd.toISOString(),
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }
}
