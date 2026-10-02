import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RemoteCommandDocument = HydratedDocument<RemoteCommandRecord>;

@Schema({ collection: 'remote_commands', timestamps: true })
export class RemoteCommandRecord {
  @Prop({ required: true, unique: true })
  commandId!: string;

  @Prop({ required: true })
  deviceId!: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'RESTART',
      'SYNC_SCHEDULE',
      'CLEAR_CACHE',
      'CUSTOM',
      'GET_SCREENSHOT',
      'UPGRADE_APP',
      'SET_VOLUME',
      'SET_BRIGHTNESS',
      'EMERGENCY_SYNC',
      'TEMP_DISABLE_KIOSK',
    ],
  })
  type!:
    | 'RESTART'
    | 'SYNC_SCHEDULE'
    | 'CLEAR_CACHE'
    | 'CUSTOM'
    | 'GET_SCREENSHOT'
    | 'UPGRADE_APP'
    | 'SET_VOLUME'
    | 'SET_BRIGHTNESS'
    | 'EMERGENCY_SYNC'
    | 'TEMP_DISABLE_KIOSK';

  @Prop({ type: Object, default: null })
  payload!: Record<string, unknown> | null;

  @Prop({
    type: String,
    required: true,
    enum: [
      'queued',
      'dispatched',
      'acknowledged',
      'failed',
      'Pending',
      'Delivered',
      'Acknowledged',
      'Acknowledged_Failure',
      'Expired',
      'Failed',
    ],
  })
  status!:
    | 'queued'
    | 'dispatched'
    | 'acknowledged'
    | 'failed'
    | 'Pending'
    | 'Delivered'
    | 'Acknowledged'
    | 'Acknowledged_Failure'
    | 'Expired'
    | 'Failed';

  @Prop({ type: Date, required: true })
  issuedAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  dispatchedAt!: Date | null;

  @Prop({ type: Date, default: null })
  deliveredAt!: Date | null;

  @Prop({ type: Date, default: null })
  acknowledgedAt!: Date | null;

  @Prop({ type: String, default: null })
  deviceResponse!: string | null;

  @Prop({ type: String, default: null })
  issuedByUserId!: string | null;

  /** `r2:{key}` after tablet uploads screenshot (GET_SCREENSHOT). */
  @Prop({ type: String, default: null })
  screenshotStorageUrl!: string | null;

  /** Set when screenshot is stored; used for retention without relying on unrelated updates. */
  @Prop({ type: Date, default: null })
  screenshotStoredAt!: Date | null;
}

export const RemoteCommandSchema =
  SchemaFactory.createForClass(RemoteCommandRecord);

RemoteCommandSchema.index({ deviceId: 1, status: 1, issuedAt: -1 });
RemoteCommandSchema.index({ expiresAt: 1, status: 1 });
