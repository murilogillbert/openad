import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ZoneResidencyIntervalDocument =
  HydratedDocument<ZoneResidencyIntervalRecord>;

@Schema({ collection: 'zone_residency_intervals', timestamps: false })
export class ZoneResidencyIntervalRecord {
  @Prop({ required: true, unique: true })
  intervalId!: string;

  @Prop({ required: true })
  deviceId!: string;

  @Prop({ required: true })
  zoneId!: string;

  @Prop({ required: true })
  enteredAt!: string;

  @Prop({ type: String, default: null })
  exitedAt!: string | null;

  @Prop({ type: Boolean, required: true })
  playedAds!: boolean;

  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  @Prop({ type: String, default: null })
  mqttDeliveryId!: string | null;
}

export const ZoneResidencyIntervalSchema = SchemaFactory.createForClass(
  ZoneResidencyIntervalRecord
);

ZoneResidencyIntervalSchema.index({ deviceId: 1, enteredAt: 1 });
ZoneResidencyIntervalSchema.index({ zoneId: 1, enteredAt: 1 });
