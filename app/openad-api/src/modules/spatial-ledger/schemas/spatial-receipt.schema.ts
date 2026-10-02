import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SpatialReceiptDocument = HydratedDocument<SpatialReceiptRecord>;

@Schema({ collection: 'spatial_receipts', timestamps: false })
export class SpatialReceiptRecord {
  @Prop({ required: true, unique: true })
  eventId!: string;

  @Prop({ required: true })
  deviceId!: string;

  @Prop({ required: true })
  mediaId!: string;

  @Prop({ required: true })
  zoneId!: string;

  @Prop({ required: true })
  startedAt!: string;

  @Prop({ required: true })
  endedAt!: string;

  @Prop({ type: Object, required: true })
  coordinateStart!: { lat: number; lng: number };

  @Prop({ type: Object, required: true })
  coordinateEnd!: { lat: number; lng: number };

  @Prop({ type: Number, required: true })
  accuracyMeters!: number;

  @Prop({ type: String, required: true, enum: ['T1', 'T2', 'T3', 'T4'] })
  tier!: 'T1' | 'T2' | 'T3' | 'T4';

  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  @Prop({ type: String, default: null })
  mqttDeliveryId!: string | null;
}

export const SpatialReceiptSchema =
  SchemaFactory.createForClass(SpatialReceiptRecord);

SpatialReceiptSchema.index({ deviceId: 1, startedAt: 1 });
SpatialReceiptSchema.index({ zoneId: 1, startedAt: 1 });
