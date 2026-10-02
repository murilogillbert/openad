import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReleaseAuditEventDocument = HydratedDocument<ReleaseAuditEvent>;

@Schema({ collection: 'release_audit_events', timestamps: true })
export class ReleaseAuditEvent {
  @Prop({ type: String, required: true })
  actorUserId!: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'release.upload',
      'release.approve',
      'release.revoke',
      'release.publish_latest',
      'rollout.create',
      'rollout.activate',
      'rollout.pause',
      'rollout.complete',
      'qr.regenerate',
      'release.command_update_check',
    ],
  })
  action!: string;

  @Prop({ type: String, required: false, default: null })
  subjectId!: string | null;

  @Prop({ type: Object, required: false, default: null })
  metadata!: Record<string, unknown> | null;
}

export const ReleaseAuditEventSchema =
  SchemaFactory.createForClass(ReleaseAuditEvent);

ReleaseAuditEventSchema.index({ createdAt: -1 });
ReleaseAuditEventSchema.index({ actorUserId: 1, createdAt: -1 });
