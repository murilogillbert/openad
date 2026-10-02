import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PairingRequestDocument = HydratedDocument<PairingRequestRecord>;

@Schema({ collection: 'pairing_requests', timestamps: true })
export class PairingRequestRecord {
  @Prop({ required: true, unique: true })
  requestId!: string;

  @Prop({ required: true })
  deviceId!: string;

  @Prop({ required: true })
  hardwareFingerprintHash!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['Pending', 'Bound', 'Expired', 'Cancelled'],
  })
  status!: 'Pending' | 'Bound' | 'Expired' | 'Cancelled';

  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  @Prop({ type: [String], default: [] })
  flags!: string[];
}

export const PairingRequestSchema =
  SchemaFactory.createForClass(PairingRequestRecord);

PairingRequestSchema.index({ deviceId: 1 });
PairingRequestSchema.index({ status: 1, createdAt: -1 });
