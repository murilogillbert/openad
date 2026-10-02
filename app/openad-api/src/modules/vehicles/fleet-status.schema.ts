import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FleetStatusDocument = HydratedDocument<FleetStatusRecord>;

/** Latest telemetry snapshot per device (`data-model.md` — `fleet_status`). */
@Schema({ collection: 'fleet_status', timestamps: false })
export class FleetStatusRecord {
  @Prop({ required: true, unique: true })
  deviceId!: string;

  @Prop({ required: true })
  vehicleId!: string;

  @Prop({ type: Date, required: true })
  reportedAt!: Date;

  @Prop({
    type: {
      type: String,
      enum: ['Point'],
      required: true,
    },
    coordinates: { type: [Number], required: true },
  })
  location!: { type: 'Point'; coordinates: [number, number] };

  @Prop({
    type: {
      status: {
        type: String,
        enum: ['online', 'degraded', 'offline'],
        required: true,
      },
    },
    required: true,
  })
  connectivity!: { status: 'online' | 'degraded' | 'offline' };

  @Prop({
    type: {
      status: {
        type: String,
        enum: ['playing', 'idle', 'error'],
        required: true,
      },
      currentCampaignId: { type: String, default: null },
    },
    required: true,
  })
  playback!: {
    status: 'playing' | 'idle' | 'error';
    currentCampaignId: string | null;
  };

  @Prop({ type: [String], default: [] })
  alertFlags!: string[];

  @Prop({ type: Number, default: null })
  lastAccuracyMeters!: number | null;
}

export const FleetStatusSchema = SchemaFactory.createForClass(FleetStatusRecord);

FleetStatusSchema.index({ reportedAt: -1 });
FleetStatusSchema.index({ 'connectivity.status': 1, reportedAt: -1 });
FleetStatusSchema.index({ location: '2dsphere' });
