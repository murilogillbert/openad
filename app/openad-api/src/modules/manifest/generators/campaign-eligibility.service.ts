import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import { PacingSignalService } from '../../analytics/services/pacing-signal.service';

/** Campanha apta a veicular agora. */
export interface EligibleCampaign {
  campaignId: string;
  /** `campaigns.priority` — 1 e a mais alta. */
  campaignPriority: number;
}

/**
 * Prioridade de manifesto para midia sem campanha (institucional, filler).
 *
 * Baixa de proposito: filler continua tocando, mas e o primeiro a ser descartado quando o
 * armazenamento do tablet aperta (`pruneLowestPriorityFirst`).
 */
export const FILLER_MANIFEST_PRIORITY = 100;

/**
 * Converte `campaigns.priority` (1 = mais alta) na prioridade do manifesto, onde maior e
 * mais importante — e a convencao que o player usa para evicao de cache.
 *
 * O piso em `FILLER_MANIFEST_PRIORITY + 10` nao e cosmetico: `campaigns.priority` so e
 * validado como `@Min(1)`, sem teto, entao sem o piso uma campanha cadastrada com
 * prioridade 90 ou mais empataria ou ficaria abaixo do filler institucional e seria
 * descartada antes dele quando o armazenamento do tablet apertasse.
 */
export function manifestPriorityFor(campaignPriority: number): number {
  const clamped = Math.min(Math.max(Math.trunc(campaignPriority), 1), 99);
  return Math.max(FILLER_MANIFEST_PRIORITY + 10, 1000 - clamped * 10);
}

/**
 * Resolve quais campanhas podem veicular neste instante.
 *
 * Existe porque o manifesto nao filtrava nada: `ManifestGeneratorService` devolvia toda a
 * midia com `isActive: true` da plataforma inteira, ordenada por data de criacao. Campanha
 * em `draft`, `completed` ou `archived` continuava sendo distribuida e tocada, campanha
 * fora da janela contratada tambem, e orcamento esgotado nao parava nada.
 */
@Injectable()
export class CampaignEligibilityService {
  constructor(
    private readonly campaigns: CampaignsRepository,
    private readonly pacing: PacingSignalService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(CampaignEligibilityService.name);
  }

  /**
   * Campanhas aptas, indexadas por `campaignId`.
   *
   * Tres criterios: status `active`, instante dentro de
   * `scheduledStart`..`scheduledEnd`, e pacing diario diferente de `paused` — este ultimo e
   * o que impede uma campanha de gastar alem do orcamento do dia.
   */
  async resolveEligible(now: Date = new Date()): Promise<Map<string, EligibleCampaign>> {
    const active = await this.campaigns.findMany({
      status: 'active',
      scheduledStart: { $lte: now },
      scheduledEnd: { $gte: now },
    });

    const eligible = new Map<string, EligibleCampaign>();
    let pausedByPacing = 0;

    for (const campaign of active) {
      const snapshot = await this.pacing.getSnapshot(campaign.campaignId);
      if (snapshot?.pacingState === 'paused') {
        pausedByPacing += 1;
        continue;
      }
      eligible.set(campaign.campaignId, {
        campaignId: campaign.campaignId,
        campaignPriority: campaign.priority,
      });
    }

    void this.logger.debug(
      {
        event: 'manifest.eligibility.resolved',
        activeInWindow: active.length,
        eligible: eligible.size,
        pausedByPacing,
      },
      'campanhas aptas resolvidas'
    );

    return eligible;
  }
}
