import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PairingSecretDocument = HydratedDocument<PairingSecretRecord>;

@Schema({ collection: 'pairing_secrets', timestamps: true })
export class PairingSecretRecord {
  @Prop({ required: true, unique: true })
  secretId!: string;

  @Prop({ required: true, index: true })
  requestId!: string;

  @Prop({ required: true })
  hash!: string;

  /** Short code shown in admin UI / typed on tablet. */
  @Prop({ required: true })
  displayCode!: string;

  @Prop({ type: Date, required: true })
  ttlExpiresAt!: Date;

  @Prop({ type: Date, default: null })
  usedAt!: Date | null;
}

export const PairingSecretSchema =
  SchemaFactory.createForClass(PairingSecretRecord);

PairingSecretSchema.index({ requestId: 1, ttlExpiresAt: -1 });
