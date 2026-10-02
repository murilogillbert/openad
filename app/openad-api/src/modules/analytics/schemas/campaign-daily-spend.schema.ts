import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CampaignDailySpendDocument = HydratedDocument<CampaignDailySpend>;

const pacingStates = ['normal', 'near_cap', 'paused'] as const;

export type PacingState = (typeof pacingStates)[number];

@Schema({ collection: 'campaign_daily_spend', timestamps: true })
export class CampaignDailySpend {
  @Prop({ required: true })
  campaignId!: string;

  /** UTC calendar day `YYYY-MM-DD` for v1 rollup. */
  @Prop({ required: true })
  dateKey!: string;

  @Prop({ required: true, default: 0 })
  billableCostCents!: number;

  /** Snapshot of interpreted daily budget cap (minor units, same as campaign budget). */
  @Prop({ required: true, default: 0 })
  budgetCents!: number;

  @Prop({
    type: String,
    required: true,
    enum: pacingStates,
    default: 'normal',
  })
  pacingState!: PacingState;
}

export const CampaignDailySpendSchema =
  SchemaFactory.createForClass(CampaignDailySpend);

CampaignDailySpendSchema.index(
  { campaignId: 1, dateKey: 1 },
  { unique: true }
);
