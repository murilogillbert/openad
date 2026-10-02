import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ScheduleRuleDocument = HydratedDocument<ScheduleRule>;

@Schema({ _id: false })
export class TimeWindowSubdoc {
  @Prop({ type: [String], required: true })
  daysOfWeek!: string[];

  @Prop({ required: true })
  startTime!: string;

  @Prop({ required: true })
  endTime!: string;

  @Prop({ required: true })
  timezone!: string;
}

@Schema({ collection: 'schedule_rules', timestamps: true })
export class ScheduleRule {
  @Prop({ required: true, unique: true })
  ruleId!: string;

  /** `campaigns.campaignId` (UUID string). */
  @Prop({ required: true })
  campaignId!: string;

  /** `creative_assets.assetId` (UUID string). */
  @Prop({ required: true })
  assetId!: string;

  @Prop({ type: [String], default: [] })
  geoZoneIds!: string[];

  @Prop({ type: [Object], default: [] })
  timeWindows!: TimeWindowSubdoc[];

  @Prop({ required: true, default: 30 })
  dwellThresholdSeconds!: number;

  @Prop({ type: Number, required: false, default: null })
  priority!: number | null;

  @Prop({
    type: String,
    required: true,
    enum: ['active', 'inactive', 'expired'],
  })
  status!: 'active' | 'inactive' | 'expired';
}

export const ScheduleRuleSchema = SchemaFactory.createForClass(ScheduleRule);

ScheduleRuleSchema.index({ campaignId: 1, status: 1 });
ScheduleRuleSchema.index({ geoZoneIds: 1, status: 1 });
ScheduleRuleSchema.index({ assetId: 1 });
