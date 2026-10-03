import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ScheduleRulesRepository } from '../schedule-rules/schedule-rules.repository';
import { CreativeAssetsRepository } from './creative-assets.repository';
import {
  MediaAsset,
  MediaAssetDocument,
} from '../media-ingestion/schemas/media-asset.schema';

export interface ProntidaoDaCampanha {
  pronta: boolean;
  /** Caminho de entrega que satisfez a verificacao, quando houver. */
  via: 'schedule_rules' | 'media_assets' | null;
  /** Motivo da recusa, para a mensagem de erro. Nulo quando `pronta`. */
  motivo: string | null;
  scheduleRules: number;
  mediaAssets: number;
}

/**
 * Responde se uma campanha tem conteudo entregavel — pre-requisito para ir ao ar.
 *
 * Existe porque a verificacao anterior, embutida em `CampaignLifecycleService.patchStatus`,
 * conhecia **apenas um** dos dois caminhos de entrega que o openad tem hoje:
 *
 * | Caminho | Conteudo | Como chega ao tablete |
 * |---|---|---|
 * | Geracao 1 (`specs/001`) | `creative_assets` + `schedule_rules` | `schedule` por MQTT |
 * | Espacial / VFS (`specs/004`, `007`) | `media_assets` com `campaignId` | `POST /manifest` |
 *
 * A exigencia era "ao menos uma regra de agendamento ativa, todas referenciando ativo
 * verificado". Campanha de anunciante nao tem nem regra nem `creative_asset`: o criativo dela
 * e uma linha de `media_assets`, e e isso que `ManifestGeneratorService` distribui depois de
 * `CampaignEligibilityService` aprovar a campanha. Ou seja, **nenhuma campanha de anunciante
 * poderia ser aprovada pela moderacao** — o moderador receberia um erro sobre regra de
 * agendamento, que nao tem relacao com a decisao que ele acabou de tomar nem com o que o
 * anunciante pode fazer a respeito.
 *
 * A regra correta e disjuncao, nao troca: qualquer um dos dois caminhos entrega, e exigir os
 * dois quebraria toda campanha de operador que existe hoje. Exigir nenhum permitiria ativar
 * campanha vazia, que o manifesto distribuiria como zero itens — campanha "no ar" que nunca
 * toca, e e justamente o que a verificacao original existia para evitar.
 */
@Injectable()
export class CampaignReadinessService {
  constructor(
    private readonly rules: ScheduleRulesRepository,
    private readonly creativeAssets: CreativeAssetsRepository,
    @InjectModel(MediaAsset.name)
    private readonly media: Model<MediaAssetDocument>
  ) {}

  async verificar(campaignId: string): Promise<ProntidaoDaCampanha> {
    const regras = await this.rules.findActiveByCampaignId(campaignId);

    /**
     * `media_assets` conta so o que de fato seria distribuido.
     *
     * `isActive: false` e midia retirada do ar e `validationStatus` diferente de `approved`
     * e arquivo que o ffprobe reprovou contra o ruleset DOOH. Contar qualquer um dos dois
     * permitiria ativar uma campanha cujo unico criativo o player recusaria — campanha no ar
     * sem nada para tocar.
     */
    const midias = await this.media
      .countDocuments({
        campaignId,
        isActive: true,
        validationStatus: 'approved',
      })
      .exec();

    if (regras.length > 0) {
      for (const regra of regras) {
        const ativo = await this.creativeAssets.findByAssetId(regra.assetId);
        if (!ativo || ativo.status !== 'verified') {
          return {
            pronta: false,
            via: null,
            motivo:
              'Toda regra de agendamento ativa precisa referenciar um criativo verificado',
            scheduleRules: regras.length,
            mediaAssets: midias,
          };
        }
      }
      return {
        pronta: true,
        via: 'schedule_rules',
        motivo: null,
        scheduleRules: regras.length,
        mediaAssets: midias,
      };
    }

    if (midias > 0) {
      return {
        pronta: true,
        via: 'media_assets',
        motivo: null,
        scheduleRules: 0,
        mediaAssets: midias,
      };
    }

    return {
      pronta: false,
      via: null,
      motivo:
        'A campanha nao tem conteudo entregavel: e preciso uma regra de agendamento com ' +
        'criativo verificado, ou ao menos um criativo aprovado no catalogo de midia',
      scheduleRules: 0,
      mediaAssets: 0,
    };
  }
}
