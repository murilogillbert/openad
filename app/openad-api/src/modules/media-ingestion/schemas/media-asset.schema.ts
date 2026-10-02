import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MediaAssetDocument = HydratedDocument<MediaAsset>;

@Schema({ timestamps: true })
export class MediaAsset {
  @Prop({ required: true, unique: true, index: true })
  mediaId!: string;

  /** Content hash (SHA-256 hex). Not unique — VFS placements may share a hash (soft copy / dedup). */
  @Prop({ required: true, index: true })
  hash!: string;

  @Prop({ type: String, required: true })
  filename!: string;

  @Prop({ type: Number, required: true })
  fileSize!: number;

  @Prop({ type: Number, required: true })
  bitrate!: number;

  @Prop({ type: Number, required: true })
  width!: number;

  @Prop({ type: Number, required: true })
  height!: number;

  @Prop({ type: String, required: true, enum: ['h264', 'h265'] })
  codec!: 'h264' | 'h265';

  @Prop({ type: Number, required: true })
  duration!: number;

  @Prop({
    type: String,
    required: true,
    enum: ['universal', 'conditional'],
    index: true,
  })
  categorization!: 'universal' | 'conditional';

  @Prop({ type: String, required: true })
  storageUrl!: string;

  @Prop({ type: String })
  uploadedBy?: string;

  @Prop({ type: Boolean, default: true, index: true })
  isActive!: boolean;

  /** VFS placement folder (Mongo ObjectId string). Legacy multipart uploads omit this. */
  @Prop({ type: String, index: true })
  folderId?: string;

  /** Denormalized campaign scope for explorer queries. */
  @Prop({ type: String, index: true })
  campaignId?: string;

  /**
   * Dono da midia — `public.users.id`. Nulo em midia institucional e em tudo que foi
   * enviado pelo operador antes da federacao de identidade.
   */
  @Prop({ type: String, default: null, index: true })
  ownerUserId?: string | null;

  /** Raw S3 object key when using presigned VFS flow (also encodable as `r2:` + key in storageUrl). */
  @Prop({ type: String })
  storageKey?: string;

  @Prop({ type: String })
  mimeType?: string;

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'rejected', 'warning'],
  })
  validationStatus?: 'pending' | 'approved' | 'rejected' | 'warning';

  @Prop({ type: Object })
  validationDetail?: Record<string, unknown>;

  @Prop({
    type: String,
    enum: ['pending', 'complete', 'failed'],
  })
  probeStatus?: 'pending' | 'complete' | 'failed';

  @Prop({ type: String })
  doohRulesetVersion?: string;

  @Prop({ type: String })
  uploadSessionId?: string;

  @Prop({
    type: String,
    enum: ['legacy_multipart', 'vfs_presign'],
  })
  vfsSource?: 'legacy_multipart' | 'vfs_presign';
}

export const MediaAssetSchema = SchemaFactory.createForClass(MediaAsset);

MediaAssetSchema.index({ categorization: 1, createdAt: -1 });
MediaAssetSchema.index(
  { ownerUserId: 1, isActive: 1 },
  { name: 'owner_active', sparse: true }
);
MediaAssetSchema.index({ folderId: 1, campaignId: 1 });
MediaAssetSchema.index({ storageKey: 1 });
