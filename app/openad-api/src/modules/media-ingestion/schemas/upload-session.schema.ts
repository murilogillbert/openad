import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UploadSessionDocument = HydratedDocument<UploadSession>;

export type UploadSessionStatus =
  | 'initiated'
  | 'completed'
  | 'aborted'
  | 'expired';

@Schema({ timestamps: true, collection: 'upload_sessions' })
export class UploadSession {
  @Prop({ type: String, required: true, unique: true, index: true })
  sessionId!: string;

  @Prop({ type: String, required: true, index: true })
  storageKey!: string;

  @Prop({ type: String, required: true })
  tenantKeyPrefix!: string;

  @Prop({ type: String, required: true, index: true })
  initiatedBy!: string;

  @Prop({ type: String, required: true })
  contentType!: string;

  @Prop({ type: String, required: true })
  originalFilename!: string;

  /** Target folder for catalog placement (Mongo ObjectId string). */
  @Prop({ type: String, default: null })
  targetFolderId!: string | null;

  /** Optional campaign scope for placement / auditing. */
  @Prop({ type: String, default: null })
  targetCampaignId!: string | null;

  @Prop({ type: [String], default: [] })
  allowedCampaignIds!: string[];

  @Prop({ type: Number, required: true })
  maxBytes!: number;

  @Prop({ type: [String], required: true })
  allowedMimeTypes!: string[];

  @Prop({ type: Date, required: true, index: true })
  expiresAt!: Date;

  @Prop({
    type: String,
    required: true,
    enum: ['initiated', 'completed', 'aborted', 'expired'],
    index: true,
  })
  status!: UploadSessionStatus;
}

export const UploadSessionSchema = SchemaFactory.createForClass(UploadSession);
