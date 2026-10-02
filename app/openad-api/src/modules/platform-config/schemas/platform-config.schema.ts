import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlatformConfigDocument = HydratedDocument<PlatformConfigDoc>;

@Schema({ collection: 'platform_config', timestamps: true })
export class PlatformConfigDoc {
  @Prop({ required: true, unique: true, default: 'fleet' })
  key!: 'fleet';

  @Prop({ required: true, default: 1 })
  version!: number;

  /** Stored as a plain JSON object; validated at controller boundary in v1. */
  @Prop({ type: Object, required: true })
  config!: Record<string, unknown>;
}

export const PlatformConfigSchema = SchemaFactory.createForClass(PlatformConfigDoc);

