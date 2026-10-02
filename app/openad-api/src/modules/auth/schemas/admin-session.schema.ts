import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AdminSessionDocument = HydratedDocument<AdminSession>;

@Schema({ collection: 'admin_sessions', timestamps: true })
export class AdminSession {
  @Prop({ required: true, unique: true })
  sessionId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  /**
   * Stable per-browser/device identifier provided by the admin portal.
   * Used to deduplicate sessions so each device has exactly one row.
   */
  @Prop({ required: false, default: null, index: true })
  deviceId!: string | null;

  @Prop({ required: true })
  label!: string;

  @Prop({ required: true })
  lastActiveAt!: Date;

  @Prop({ required: false, default: null })
  revokedAt!: Date | null;
}

export const AdminSessionSchema = SchemaFactory.createForClass(AdminSession);

// Ensure one session row per (userId, deviceId) without breaking older rows that have no deviceId.
AdminSessionSchema.index(
  { userId: 1, deviceId: 1 },
  {
    unique: true,
    partialFilterExpression: { deviceId: { $type: 'string' } },
  }
);

