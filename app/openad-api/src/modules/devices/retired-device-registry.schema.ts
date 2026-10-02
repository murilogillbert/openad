import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RetiredDeviceRegistryDocument =
  HydratedDocument<RetiredDeviceRegistry>;

@Schema({ collection: 'retired_device_registry', timestamps: false })
export class RetiredDeviceRegistry {
  @Prop({ required: true, unique: true })
  deviceId!: string;

  @Prop({ type: Date, required: true })
  retiredAt!: Date;

  @Prop({ required: true })
  retiredByAdminId!: string;
}

export const RetiredDeviceRegistrySchema = SchemaFactory.createForClass(
  RetiredDeviceRegistry
);
