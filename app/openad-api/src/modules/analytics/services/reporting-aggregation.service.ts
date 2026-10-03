import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
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

    const tierBuckets = new Map<string, { plays: number; amountCents: number }>();

    /**
     * Acumulacao em inteiro.
     *
     * A versao anterior somava `rate * zoneMult` em float sobre N veiculacoes: erro de
     * arredondamento que **cresce com o volume**, justamente num numero que vai para a fatura
     * do anunciante. O multiplicador de tier continua fracionario, entao o arredondamento
     * acontece uma vez por linha, com `Math.round`, e o total e soma de inteiros.
     */
    let revenueTotalCents = 0;
    for (const _p of plays) {
      const tier = 'T4';
      const zoneMult = tierZoneMultiplier(tier);
      const lineAmountCents = Math.round(rateCents * zoneMult);
      revenueTotalCents += lineAmountCents;

      const prev = tierBuckets.get(tier) ?? { plays: 0, amountCents: 0 };
      tierBuckets.set(tier, {
        plays: prev.plays + 1,
        amountCents: prev.amountCents + lineAmountCents,
      });
    }

    const revenueLines = [...tierBuckets.entries()].map(([tier, v]) => ({
      label: `zone_tier_${tier}`,
      plays: v.plays,
      amountCents: v.amountCents,
    }));

    return {
      campaignId,
      window: { from: from.toISOString(), to: to.toISOString() },
      impressions: plays.length,
      reach: distinctVehicles.size,
      revenueTotalCents,
      currency: campaign.budget.currency,
      revenueLines,
    };
  }
}

function tierZoneMultiplier(tier: string): number {
  return TIER_ZONE_MULTIPLIER[tier] ?? 1.0;
}
