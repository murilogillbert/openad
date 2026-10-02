import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DeviceGroupDocument = HydratedDocument<DeviceGroup>;

@Schema({ collection: 'device_groups', timestamps: true })
export class DeviceGroup {
  @Prop({ required: true, unique: true })
  groupId!: string;

  @Prop({ required: true, unique: true })
  name!: string;

  @Prop({ required: true, index: true })
  profileId!: string;

  /** 003 — optional sync window rules (group-level). */
  @Prop({
    type: [
      {
        ruleId: { type: String, required: true },
        startTime: { type: String, required: true },
        endTime: { type: String, required: true },
        daysOfWeek: [{ type: Number }],
        sizeThresholdMb: { type: Number, required: true },
      },
    ],
    default: undefined,
  })
  syncWindowRules?: Array<{
    ruleId: string;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    sizeThresholdMb: number;
  }>;

  @Prop({ type: Number, default: 0 })
  configRevision?: number;
}

export const DeviceGroupSchema = SchemaFactory.createForClass(DeviceGroup);
