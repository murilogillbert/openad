import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PairingAttemptLogDocument = HydratedDocument<PairingAttemptLogRecord>;

@Schema({ collection: 'pairing_attempt_logs', timestamps: true })
export class PairingAttemptLogRecord {
  @Prop({ required: true, unique: true })
  logId!: string;

  @Prop({ type: String, default: null, index: true })
  deviceId!: string | null;

  @Prop({ required: true })
  fingerprintHash!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['success', 'failure', 'expired', 'replay', 'hardware_mismatch'],
  })
  outcome!:
    | 'success'
    | 'failure'
    | 'expired'
    | 'replay'
    | 'hardware_mismatch';

  @Prop({ type: String, default: null })
  detail!: string | null;
}

export const PairingAttemptLogSchema =
  SchemaFactory.createForClass(PairingAttemptLogRecord);

PairingAttemptLogSchema.index({ deviceId: 1, createdAt: -1 });
