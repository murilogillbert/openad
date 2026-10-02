import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SecurityAuditEventDocument = HydratedDocument<SecurityAuditEvent>;

@Schema({ collection: 'security_audit_events', timestamps: true })
export class SecurityAuditEvent {
  @Prop({ required: true, unique: true })
  eventId!: string;

  @Prop({ required: true, index: true })
  actorUserId!: string;

  @Prop({ required: true })
  action!:
    | 'session.revoke_others'
    | 'password.change'
    | 'profile.update'
    | 'profile.photo.upload'
    | 'profile.photo.delete'
    | 'platform_config.save'
    | 'platform_config.restore_defaults'
    | 'release.force_update_check';

  @Prop({ required: false, default: null })
  subjectId!: string | null;

  @Prop({ type: Object, required: true, default: {} })
  metadata!: Record<string, unknown>;
}

export const SecurityAuditEventSchema =
  SchemaFactory.createForClass(SecurityAuditEvent);

