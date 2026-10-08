import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import {
  microsParaCentavos,
  MICROS_POR_CENTAVO,
} from '../../monetization/pricing.policy';
import { PlayRecord } from '../schemas/play-record.schema';

/** Tier-based zone cost multipliers (FR-011 — geo tiers apply at campaign / play context). */
const TIER_ZONE_MULTIPLIER: Record<string, number> = {
  T1: 1.15,
  T2: 1.1,
  T3: 1.05,
  T4: 1.0,
};

export interface CampaignReportingSummary {
  campaignId: string;
  window: { from: string; to: string };
  impressions: number;
  /** Distinct vehicles with ≥1 billable play (SC-003). */
  reach: number;
  /** Soma das linhas de custo por veiculacao, em centavos inteiros. */
  revenueTotalCents: number;
  currency: string;
  /** One line per distinct zone tier observed (optional breakdown). */
  revenueLines: Array<{
    label: string;
    plays: number;
    amountCents: number;
  }>;

  /**
   * Campos **aditivos**. Cliente que não os conhece ignora, e por isso entram como campos
   * novos em vez de trocarem os existentes: o painel de gestão e o app do anunciante já
   * consomem este contrato.
   */

  /** Segundos de tela entregues no período. É o que o anunciante compra. */
  secondsDisplayed: number;
  /**
   * O mesmo total de `revenueTotalCents`, sem a perda do arredondamento.
   *
   * Existe porque a R$ 0,003/s uma imagem custa 4,5 centavos: o total em centavos é a verdade
   * arredondada, e o em micro-reais é a verdade.
   */
  revenueTotalMicros: number;
  /** Custo médio por exibição, em µR$ — o número que compara criativos entre si. */
  averageCostPerPlayMicros: number;
}

@Injectable()
export class ReportingAggregationService {
  constructor(
    @InjectModel(PlayRecord.name)
    private readonly playRecords: Model<PlayRecord>,
    private readonly campaigns: CampaignsRepository
  ) {}

  async summarizeCampaign(
    campaignId: string,
    from: Date,
    to: Date
  ): Promise<CampaignReportingSummary> {
    const campaign = await this.campaigns.findByCampaignId(campaignId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const plays = await this.playRecords
      .find({
        campaignId,
        billable: true,
        reconciliationStatus: 'billable',
        timestampStart: { $gte: from, $lte: to },
      })
      .lean()
      .exec();

    const distinctVehicles = new Set(plays.map((p) => p.vehicleId));
    const rateCents = campaign.budget.ratePerImpressionCents;

    const tierBuckets = new Map<string, { plays: number; amountMicros: number }>();

    /**
     * Soma o que foi **cobrado**, em vez de recalcular pela tarifa atual.
     *
     * A versão anterior multiplicava exibições pela tarifa da campanha. Isso tem dois
     * problemas, e o segundo é sério: com preço por segundo, exibições da mesma campanha
     * custam valores diferentes (imagem de 15 s × vídeo de 60 s), então a multiplicação
     * simplesmente não descreve mais o gasto. E um reajuste de preço **reescreveria o
     * passado** — o relatório de um mês fechado mudaria de valor.
     *
     * `billedCostMicros` é gravado na veiculação no instante da cobrança, então o relatório
     * soma fatos. Veiculação cobrada antes desta mudança não tem o campo, e aí vale o
     * recálculo antigo: é o único número disponível para ela, e mostrar zero seria pior.
     *
     * O acúmulo é em micro-reais porque uma imagem de 15 s custa 4,5 centavos; somar em
     * centavos arredondados por linha produziria um total que não fecha com o gasto.
     *
     * `tierZoneMultiplier` está fixo em `'T4'` (fator 1,0), então hoje não altera nada. Ficou
     * no lugar de propósito: a estrutura por tier é o que a tela já consome, e removê-la aqui
     * seria uma mudança de contrato sem relação com esta frente.
     */
    let revenueTotalMicros = 0;
    for (const p of plays) {
      const tier = 'T4';
      const zoneMult = tierZoneMultiplier(tier);
      const custoMicros =
        p.billedCostMicros ?? rateCents * MICROS_POR_CENTAVO;
      const lineAmountMicros = Math.floor(custoMicros * zoneMult);
      revenueTotalMicros += lineAmountMicros;

      const prev = tierBuckets.get(tier) ?? { plays: 0, amountMicros: 0 };
      tierBuckets.set(tier, {
        plays: prev.plays + 1,
        amountMicros: prev.amountMicros + lineAmountMicros,
      });
    }

    const revenueLines = [...tierBuckets.entries()].map(([tier, v]) => ({
      label: `zone_tier_${tier}`,
      plays: v.plays,
      // A conversão para centavos acontece aqui, na fronteira da resposta, e uma vez só sobre
      // o acumulado — não por linha.
      amountCents: microsParaCentavos(v.amountMicros).centavos,
    }));

    /** Segundos de tela no período. É o que o anunciante compra, então é o que ele deve ver. */
    const secondsDisplayed = plays.reduce((s, p) => s + (p.billedSeconds ?? 0), 0);

    return {
      campaignId,
      window: { from: from.toISOString(), to: to.toISOString() },
      impressions: plays.length,
      reach: distinctVehicles.size,
      revenueTotalCents: microsParaCentavos(revenueTotalMicros).centavos,
      currency: campaign.budget.currency,
      revenueLines,
      /**
       * Campos novos e **aditivos**: cliente que não os conhece ignora. Respondem as duas
       * perguntas que o relatório antigo não respondia — quantos segundos de tela foram
       * entregues, e quanto custou cada exibição em média, que é o número que o anunciante usa
       * para comparar criativos.
       */
      secondsDisplayed,
      revenueTotalMicros,
      averageCostPerPlayMicros: plays.length
        ? Math.floor(revenueTotalMicros / plays.length)
        : 0,
    };
  }
}

function tierZoneMultiplier(tier: string): number {
  return TIER_ZONE_MULTIPLIER[tier] ?? 1.0;
}
