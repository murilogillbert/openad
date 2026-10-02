import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CreativeAssetDocument = HydratedDocument<CreativeAsset>;

@Schema({ collection: 'creative_assets', timestamps: true })
export class CreativeAsset {
  @Prop({ required: true, unique: true })
  assetId!: string;

  /** `campaigns.campaignId` (UUID string). */
  @Prop({ required: true })
  campaignId!: string;

  @Prop({ type: Number, required: true, default: 1 })
  version!: number;

  @Prop({ type: String, required: true })
  filename!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['video/mp4', 'image/jpeg', 'image/png', 'image/webp'],
  })
  mimeType!: 'video/mp4' | 'image/jpeg' | 'image/png' | 'image/webp';

  @Prop({ type: Number, required: true })
  fileSizeBytes!: number;

  /** Local absolute path, or `r2:{objectKey}` when using Cloudflare R2. */
  @Prop({ type: String, required: true })
  storageUrl!: string;

  @Prop({ type: String, required: true })
  checksumSha256!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['pending', 'verified', 'rejected', 'deprecated'],
  })
  status!: 'pending' | 'verified' | 'rejected' | 'deprecated';

  @Prop({ type: String, default: null })
  uploadedBy!: string | null;

  @Prop({ type: Date, default: null })
  verifiedAt!: Date | null;
}

export const CreativeAssetSchema = SchemaFactory.createForClass(CreativeAsset);

CreativeAssetSchema.index({ campaignId: 1, version: -1 });
CreativeAssetSchema.index({ status: 1 });
