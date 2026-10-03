import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import type { DeviceStateDto } from '../dto/manifest-request.dto';
import type { ManifestMediaItemDto } from '../dto/manifest-response.dto';
import {
  MediaAsset,
  MediaAssetDocument,
} from '../../media-ingestion/schemas/media-asset.schema';
import { AssetStorageService } from '../../../infrastructure/storage/asset-storage.service';
import type { SpatialEntryContract } from '@openad/api-contracts';
import { SpatialManifestBuilderService } from './spatial-manifest-builder.service';
import {
  CampaignEligibilityService,
  FILLER_MANIFEST_PRIORITY,
  manifestPriorityFor,
} from './campaign-eligibility.service';
import { TargetingMatcherService } from './targeting-matcher.service';

export interface GeneratedManifestPayload {
  deviceId: string;
  version: string;
  media: ManifestMediaItemDto[];
  spatial: { version: string; entries: SpatialEntryContract[] };
}

@Injectable()
export class ManifestGeneratorService {
  constructor(
    @InjectModel(MediaAsset.name)
    private readonly mediaModel: Model<MediaAssetDocument>,
    private readonly storage: AssetStorageService,
    private readonly spatialManifest: SpatialManifestBuilderService,
    private readonly eligibility: CampaignEligibilityService,
    private readonly targeting: TargetingMatcherService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ManifestGeneratorService.name);
  }

  /**
   * Monta o manifesto do dispositivo.
   *
   * Antes devolvia **toda** a midia com `isActive: true` da plataforma, ordenada por data de
   * criacao, com a prioridade derivada da posicao na lista (`1000 - i * 10`). Campanha em
   * `draft` ou `completed` continuava sendo distribuida, campanha fora da janela contratada
   * tambem, e orcamento esgotado nao parava nada — ou seja, nao havia como garantir entrega
   * nem faturar com confianca.
   *
   * Agora: midia de campanha entra so se a campanha estiver apta (ver
   * {@link CampaignEligibilityService}), e a prioridade vem da campanha. Midia sem
   * `campaignId` — institucional, filler — continua entrando, com prioridade baixa.
   */
  async build(
    deviceId: string,
    deviceState: DeviceStateDto | undefined
  ): Promise<GeneratedManifestPayload> {
    const eligible = await this.eligibility.resolveEligible();

    /**
     * Contexto do tablete: veículo, tier e as zonas que contêm a posição reportada.
     *
     * Até esta leva o `deviceState` era descartado com `void deviceState`, e a consequência
     * era concreta: `campaigns.targeting` era gravado pelas rotas do anunciante e **nunca**
     * consultado na entrega, então toda campanha ia para toda a frota. Quem pagou por uma
     * cidade recebia veiculação de todo o país.
     */
    const ctx = await this.targeting.contextoDe(deviceId, deviceState);

    const rows = await this.mediaModel
      .find({ isActive: true })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const media: ManifestMediaItemDto[] = [];
    let skippedIneligible = 0;
    let skippedTargeting = 0;

    for (const row of rows) {
      const campaignId = row.campaignId;

      let priority: number;
      if (campaignId) {
        const campaign = eligible.get(campaignId);
        if (!campaign) {
          skippedIneligible += 1;
          continue;
        }

        const alcance = this.targeting.alcanca(campaign.targeting, ctx);
        if (!alcance.ok) {
          skippedTargeting += 1;
          /**
           * Supressão medida, não silenciosa — mas em contador, não em documento.
           *
           * A pergunta que isto responde é "por que a minha campanha tocou menos?". Gravar um
           * evento por item suprimido custaria da ordem de `frota x campanhas` escritas a
           * cada ciclo de 15 min, para um dado que ninguém lê evento a evento. O contador dá
           * a mesma resposta; o `campaignId` vai no log estruturado, que é onde investigação
           * individual acontece.
           */
          this.metrics.manifestTargetingSuppressedTotal.inc({
            reason: alcance.motivo,
          });
          void this.logger.debug(
            {
              event: 'manifest.targeting.suppressed',
              deviceId,
              campaignId,
              mediaId: row.mediaId,
              reason: alcance.motivo,
            },
            'item suprimido do manifesto por segmentacao'
          );
          continue;
        }

        priority = manifestPriorityFor(campaign.campaignPriority);
        /**
         * Leilão de repasse: campanha que paga mais ao motorista ganha mais inventário.
         *
         * Entra como multiplicador da prioridade, não como termo somado, para que o efeito
         * seja proporcional e não atropele a faixa de prioridade. `k = 0` em
         * `platform_config` desliga o leilão e mantém só o piso.
         */
        priority = Math.round(priority * campaign.payoutBoost);
      } else {
        priority = FILLER_MANIFEST_PRIORITY;
      }

      const downloadUrl = await this.storage.getPresignedGetUrl(
        row.storageUrl,
        3600
      );
      const item: ManifestMediaItemDto = {
        mediaId: row.mediaId,
        hash: row.hash,
        priority,
        downloadUrl,
        fileSize: row.fileSize,
        duration: row.duration,
      };
      if (campaignId) {
        item.campaignId = campaignId;
      }
      media.push(item);
    }

    // Maior prioridade primeiro: o player usa a ordem para evicao de cache.
    media.sort((a, b) => b.priority - a.priority);

    const version = new Date().toISOString();
    void this.logger.debug(
      {
        event: 'manifest.generated',
        deviceId,
        count: media.length,
        skippedIneligible,
        skippedTargeting,
        zonesMatched: ctx.zoneIds.length,
        vehicleTier: ctx.vehicleTier,
      },
      'manifest generated'
    );

    const spatialBuildStarted = process.hrtime.bigint();
    const spatial = await this.spatialManifest.build();
    const spatialElapsedSec =
      Number(process.hrtime.bigint() - spatialBuildStarted) / 1e9;
    this.metrics.spatialManifestBuildSeconds.observe(spatialElapsedSec);

    return { deviceId, version, media, spatial };
  }
}
