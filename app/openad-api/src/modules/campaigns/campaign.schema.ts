import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CampaignDocument = HydratedDocument<Campaign>;

@Schema({ _id: false })
export class CampaignBudgetSubdoc {
  @Prop({ type: Number, required: true })
  totalAmount!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: Number, required: true })
  ratePerImpression!: number;
}

@Schema({ collection: 'campaigns', timestamps: true })
export class Campaign {
  @Prop({ type: String, required: true })
  campaignId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  advertiserName!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['draft', 'active', 'paused', 'completed', 'archived'],
  })
  status!: 'draft' | 'active' | 'paused' | 'completed' | 'archived';

  /** Lower number = higher priority (1 = highest). */
  @Prop({ type: Number, required: true })
  priority!: number;

  @Prop({ type: Object, required: true })
  budget!: CampaignBudgetSubdoc;

  @Prop({ type: Date, required: true })
  scheduledStart!: Date;

  @Prop({ type: Date, required: true })
  scheduledEnd!: Date;

  @Prop({ type: String, default: null })
  createdBy!: string | null;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);

CampaignSchema.index({ campaignId: 1 }, { unique: true, name: 'campaignId_1' });

CampaignSchema.index({ status: 1, scheduledStart: 1, scheduledEnd: 1 });
CampaignSchema.index({ priority: 1, status: 1 });
