import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RolloutDocument = HydratedDocument<RolloutRecord>;

@Schema({ collection: 'release_rollouts', timestamps: true })
export class RolloutRecord {
  @Prop({ type: Types.ObjectId, ref: 'AppRelease', required: true })
  releaseId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['draft', 'active', 'paused', 'completed', 'cancelled'],
    required: true,
    default: 'draft',
  })
  status!: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

  @Prop({ type: [String], default: [] })
  deviceGroupIds!: string[];

  @Prop({ type: Number, required: false, default: null })
  percentage!: number | null;

  @Prop({ type: Date, required: false, default: null })
  startedAt!: Date | null;

  @Prop({ type: Date, required: false, default: null })
  endedAt!: Date | null;
}

export const RolloutSchema = SchemaFactory.createForClass(RolloutRecord);

RolloutSchema.index({ releaseId: 1, status: 1 });
