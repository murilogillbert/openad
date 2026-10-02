import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppReleaseDocument = HydratedDocument<AppRelease>;

@Schema({ collection: 'app_releases', timestamps: true })
export class AppRelease {
  @Prop({ type: String, required: true })
  versionIdentifier!: string;

  @Prop({ type: Number, required: false, default: null })
  buildNumber!: number | null;

  @Prop({ type: String, required: true })
  storageRef!: string;

  @Prop({ type: String, required: true })
  sha256Hex!: string;

  @Prop({ type: Number, required: true })
  sizeBytes!: number;

  @Prop({
    type: String,
    enum: ['uploaded', 'approved', 'revoked'],
    required: true,
    default: 'uploaded',
  })
  status!: 'uploaded' | 'approved' | 'revoked';

  @Prop({
    type: String,
    enum: ['stable'],
    required: true,
    default: 'stable',
  })
  channel!: 'stable';

  /** Opaque token used in public artifact URLs (not guessable). */
  @Prop({ type: String, required: true, unique: true })
  artifactAccessToken!: string;

  @Prop({ type: String, required: true })
  originalFilename!: string;

  /** Admin-visible release notes (not public). */
  @Prop({ type: String, required: false, default: '' })
  releaseNotes!: string;

  @Prop({ type: String, required: true })
  uploadedByUserId!: string;
}

export const AppReleaseSchema = SchemaFactory.createForClass(AppRelease);

AppReleaseSchema.index({ versionIdentifier: 1, channel: 1 });
AppReleaseSchema.index({ createdAt: -1 });
