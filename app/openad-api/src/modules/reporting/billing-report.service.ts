import { Injectable } from '@nestjs/common';
import type { BillingReportResponse } from '@openad/api-contracts';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { ImpressionEventsRepository } from '../impressions/impression-events.repository';

@Injectable()
export class BillingReportService {
  constructor(
    private readonly impressions: ImpressionEventsRepository,
    private readonly campaigns: CampaignsRepository
  ) {}

  /**
   * Fatura o periodo somando **centavos inteiros**.
   *
   * O `$sum` do Mongo preserva o tipo do campo somado: com `billingValue` em double, o total de
   * um mes de veiculacao acumulava erro de ponto flutuante justamente no numero que vai para a
   * fatura. Somando `billingValueCents`, que e inteiro, o total e exato por construcao.
   */
  async getBilling(from: Date, to: Date): Promise<BillingReportResponse> {
    const byCampaignAgg = (await this.impressions.aggregate([
      {
        $match: {
          playedAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: '$campaignId',
          impressions: { $sum: 1 },
          billableValueCents: { $sum: '$billingValueCents' },
          currency: { $first: '$currency' },
        },
      },
    ])) as {
      _id: string;
      impressions: number;
      billableValueCents: number;
      currency: string;
    }[];

    const byCampaign: BillingReportResponse['byCampaign'] = [];
    for (const row of byCampaignAgg) {
      const c = await this.campaigns.findByCampaignId(row._id);
      byCampaign.push({
        campaignId: row._id,
        campaignName: c?.name ?? row._id,
        impressions: row.impressions,
        billableValueCents: row.billableValueCents,
        currency: row.currency,
      });
    }

    const byOperatorAgg = (await this.impressions.aggregate([
      {
        $match: {
          playedAt: { $gte: from, $lte: to },
        },
      },
      {
        $lookup: {
          from: 'vehicles',
          localField: 'vehicleId',
          foreignField: 'vehicleId',
          as: 'vehicle',
        },
      },
      { $unwind: '$vehicle' },
      {
        $group: {
          _id: '$vehicle.operatorId',
          impressions: { $sum: 1 },
          payableAmountCents: { $sum: '$billingValueCents' },
          vehicles: { $addToSet: '$vehicleId' },
        },
      },
    ])) as {
      _id: string;
      impressions: number;
      payableAmountCents: number;
      vehicles: string[];
    }[];

    const byOperator: BillingReportResponse['byOperator'] = byOperatorAgg.map(
      (r) => ({
        operatorId: r._id,
        vehicleCount: r.vehicles.length,
        impressions: r.impressions,
        payableAmountCents: r.payableAmountCents,
      })
    );

    return {
      period: { start: from.toISOString(), end: to.toISOString() },
      byCampaign,
      byOperator,
    };
  }
}
