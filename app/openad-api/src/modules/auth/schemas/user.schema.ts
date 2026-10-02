import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { UserRole } from '@openad/domain';

export type UserDocument = HydratedDocument<User>;

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  userId!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true })
  displayName!: string;

  /** Admin-visible contact email for profile page (may differ from login email). */
  @Prop({ type: String, required: false, default: null })
  contactEmail!: string | null;

  /** Admin-visible contact phone for profile page. */
  @Prop({ type: String, required: false, default: null })
  contactPhone!: string | null;

  /** Optional profile photo URL (future: object storage). */
  @Prop({ type: String, required: false, default: null })
  photoUrl!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: [
      'fleet_operator',
      'campaign_manager',
      'fleet_admin',
      'finance_analyst',
      'super_admin',
    ],
  })
  role!: UserRole;
}

export const UserSchema = SchemaFactory.createForClass(User);
