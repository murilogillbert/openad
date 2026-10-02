import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlayRecordDocument = HydratedDocument<PlayRecord>;

const reconciliationStatuses = [
  'pending',
  'billable',
  'partial',
  'duplicate',
  'geofence_failed',
  'fraud_velocity',
  'fraud_heartbeat',
  'blackout',
  'audit',
] as const;

export type ReconciliationStatus = (typeof reconciliationStatuses)[number];

@Schema({ collection: 'play_records', timestamps: false })
export class PlayRecord {
  @Prop({ required: true })
  uniqueEventId!: string;

  @Prop({ required: true })
  deviceId!: string;

  @Prop({ required: true })
  vehicleId!: string;

  @Prop({ required: true })
  campaignId!: string;

  @Prop({ type: String, default: null })
  mediaId!: string | null;

  @Prop({ type: Date, required: true })
  timestampStart!: Date;

  @Prop({ type: Date, required: true })
  timestampEnd!: Date;

  @Prop({ type: Number, required: true })
  latStart!: number;

  @Prop({ type: Number, required: true })
  lngStart!: number;

  @Prop({ type: Number, required: true })
  latEnd!: number;

  @Prop({ type: Number, required: true })
  lngEnd!: number;

  @Prop({
    type: String,
    required: true,
    enum: ['Geofence_Entry', 'Standard_Loop', 'Admin_Force'],
  })
  triggerReason!: string;

  @Prop({ type: Number, required: true })
  batteryLevel!: number;

  @Prop({ type: String, required: true })
  networkType!: string;

  @Prop({ type: Number, required: true })
  gpsAccuracyM!: number;

  @Prop({ type: Number, default: null })
  displayLux!: number | null;

  @Prop({ type: Date, required: true })
  ingestedAt!: Date;

  @Prop({ type: String, required: true })
  batchId!: string;

  @Prop({
    type: String,
    required: true,
    enum: reconciliationStatuses,
  })
  reconciliationStatus!: ReconciliationStatus;

  @Prop({ type: Boolean, required: true })
  billable!: boolean;

  @Prop({ type: Number, default: null })
  impliedSpeedKmh!: number | null;

  @Prop({ type: Number, default: null })
  heartbeatRatio!: number | null;
}

export const PlayRecordSchema = SchemaFactory.createForClass(PlayRecord);

PlayRecordSchema.index({ deviceId: 1, uniqueEventId: 1 }, { unique: true });
PlayRecordSchema.index({ campaignId: 1, timestampStart: -1 });
PlayRecordSchema.index({ vehicleId: 1, campaignId: 1, timestampStart: -1 });
PlayRecordSchema.index({ reconciliationStatus: 1, ingestedAt: -1 });
