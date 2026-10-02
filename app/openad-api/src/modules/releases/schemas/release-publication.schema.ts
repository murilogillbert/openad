import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReleasePublicationDocument = HydratedDocument<ReleasePublication>;

/** Single “latest stable” pointer for QR installs (channel stable). */
@Schema({ collection: 'release_publications', timestamps: true })
export class ReleasePublication {
  @Prop({
    type: String,
    enum: ['stable'],
    required: true,
    unique: true,
  })
  channel!: 'stable';

  @Prop({ type: Types.ObjectId, ref: 'AppRelease', required: true })
  releaseId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  publishedAt!: Date;

  @Prop({ type: String, required: true })
  publishedByUserId!: string;
}

export const ReleasePublicationSchema =
  SchemaFactory.createForClass(ReleasePublication);
