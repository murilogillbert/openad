import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ManifestVersionDocument = HydratedDocument<ManifestVersionRecord>;

@Schema({ collection: 'manifest_versions', timestamps: true })
export class ManifestVersionRecord {
  /** Monotonic fleet manifest version. */
  @Prop({ required: true, unique: true, index: true })
  manifestVersion!: number;

  @Prop({
    type: [
      {
        assetId: { type: String, required: true },
        url: { type: String, required: true },
        checksumSha256: { type: String, required: true },
        sizeBytes: { type: Number, required: true },
      },
    ],
    required: true,
    default: [],
  })
  assets!: Array<{
    assetId: string;
    url: string;
    checksumSha256: string;
    sizeBytes: number;
  }>;

  @Prop({ type: Date, required: true })
  generatedAt!: Date;
}

export const ManifestVersionSchema =
  SchemaFactory.createForClass(ManifestVersionRecord);

ManifestVersionSchema.index({ manifestVersion: -1 });
