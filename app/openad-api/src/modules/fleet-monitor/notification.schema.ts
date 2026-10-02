import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<NotificationRecord>;

@Schema({ collection: 'notifications', timestamps: true })
export class NotificationRecord {
  @Prop({ required: true })
  notificationId!: string;

  @Prop({ required: true })
  type!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ default: false })
  read!: boolean;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;
}

export const NotificationSchema = SchemaFactory.createForClass(NotificationRecord);

NotificationSchema.index({ notificationId: 1 }, { unique: true });
NotificationSchema.index({ createdAt: -1 });
