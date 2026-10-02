import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import type { CampaignDocument } from '../../campaigns/campaign.schema';
import {
  CampaignDailySpend,
  type PacingState,
} from '../schemas/campaign-daily-spend.schema';

/** Spend ≥ this fraction of daily budget → near_cap (FR-012 / SC-006). */
const NEAR_CAP_FRACTION = 0.95;

@Injectable()
export class PacingSignalService {
  constructor(
    @InjectModel(CampaignDailySpend.name)
    private readonly dailySpend: Model<CampaignDailySpend>,
    private readonly campaigns: CampaignsRepository
  ) {}

  /**
   * Multiplier applied to spatial manifest `pacingFactor` when a campaign is near daily cap.
   */
  async getPacingDeliveryMultiplier(campaignId: string): Promise<number> {
    const row = await this.findTodayRow(campaignId);
    if (!row) {
      return 1;
    }
    if (row.pacingState === 'paused') {
      return 0.1;
    }
    if (row.pacingState === 'near_cap') {
      return 0.5;
    }
    return 1;
  }

  async getSnapshot(campaignId: string): Promise<{
    campaignId: string;
    dateKey: string;
    billableCostCents: number;
    budgetCents: number;
    pacingState: PacingState;
  } | null> {
    const row = await this.findTodayRow(campaignId);
    if (!row) {
      return null;
    }
    return {
      campaignId: row.campaignId,
      dateKey: row.dateKey,
      billableCostCents: row.billableCostCents,
      budgetCents: row.budgetCents,
      pacingState: row.pacingState,
    };
  }

  /**
   * Increment daily billable cost after a play is classified billable (post fraud).
   */
  async recordBillablePlayCost(params: {
    campaignId: string;
    costCents: number;
    at: Date;
  }): Promise<void> {
    if (params.costCents <= 0) {
      return;
    }
    const campaign = await this.campaigns.findByCampaignId(params.campaignId);
    if (!campaign) {
      return;
    }
    const dateKey = utcDateKey(params.at);
    const budgetCents = this.dailyBudgetCents(campaign);

    await this.dailySpend.updateOne(
      { campaignId: params.campaignId, dateKey },
      {
        $setOnInsert: {
          campaignId: params.campaignId,
          dateKey,
          budgetCents,
          pacingState: 'normal',
        },
        $inc: { billableCostCents: Math.round(params.costCents) },
      },
      { upsert: true }
    );

    const row = await this.dailySpend
      .findOne({ campaignId: params.campaignId, dateKey })
      .lean()
      .exec();
    if (!row) {
      return;
    }
    const next = this.resolvePacingState(row.billableCostCents, row.budgetCents);
    if (next !== row.pacingState) {
      await this.dailySpend.updateOne(
        { campaignId: params.campaignId, dateKey },
        { $set: { pacingState: next } }
      );
    }
  }

  private resolvePacingState(
    spent: number,
    budget: number
  ): PacingState {
    if (budget <= 0) {
      return 'normal';
    }
    if (spent >= budget) {
      return 'paused';
    }
    if (spent >= budget * NEAR_CAP_FRACTION) {
      return 'near_cap';
    }
    return 'normal';
  }

  private dailyBudgetCents(c: CampaignDocument): number {
    const total = c.budget?.totalAmount ?? 0;
    const start = c.scheduledStart?.getTime?.() ?? Date.now();
    const end = c.scheduledEnd?.getTime?.() ?? Date.now() + 86400000;
    const days = Math.max(1, Math.ceil((end - start) / 86400000));
    return Math.max(1, Math.floor(total / days));
  }

  private async findTodayRow(
    campaignId: string
  ): Promise<CampaignDailySpend | null> {
    const dateKey = utcDateKey(new Date());
    return this.dailySpend.findOne({ campaignId, dateKey }).exec();
  }
}

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
