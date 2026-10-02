import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DeviceManifestSyncDocument = HydratedDocument<DeviceManifestSync>;

@Schema({ timestamps: true, collection: 'device_manifest_sync' })
export class DeviceManifestSync {
  @Prop({ required: true, unique: true, index: true })
  deviceId!: string;

  @Prop({ type: String })
  lastManifestVersion?: string;

  @Prop({ type: Date })
  lastSyncedAt?: Date;

  @Prop({ type: [Object], default: [] })
  lastDownloadedMedia!: Array<{
    mediaId: string;
    hash: string;
    verified: boolean;
  }>;

  @Prop({ type: Number })
  storageUsedBytes?: number;
}

export const DeviceManifestSyncSchema =
  SchemaFactory.createForClass(DeviceManifestSync);
