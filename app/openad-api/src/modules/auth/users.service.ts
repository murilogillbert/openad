import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { User, UserDocument } from './schemas/user.schema';

export type SeedAdminUserResult =
  | { status: 'created'; email: string }
  | { status: 'skipped'; reason: 'users_exist' | 'missing_credentials' };

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SEED_STANDALONE === 'true') {
      return;
    }
    await this.seedDefaultUser();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findByUserId(userId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ userId }).exec();
  }

  async findByUserIds(userIds: string[]): Promise<UserDocument[]> {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (ids.length === 0) return [];
    return this.userModel.find({ userId: { $in: ids } }).exec();
  }

  async updateAdminProfile(params: {
    userId: string;
    displayName?: string;
    contactEmail?: string | null;
    contactPhone?: string | null;
    clearPhoto?: boolean;
  }): Promise<UserDocument> {
    const patch: Partial<User> = {};
    if (params.displayName !== undefined) patch.displayName = params.displayName.trim();
    if (params.contactEmail !== undefined)
      patch.contactEmail = params.contactEmail ? params.contactEmail.trim() : null;
    if (params.contactPhone !== undefined)
      patch.contactPhone = params.contactPhone ? params.contactPhone.trim() : null;
    if (params.clearPhoto) patch.photoUrl = null;

    const doc = await this.userModel
      .findOneAndUpdate(
        { userId: params.userId },
        { $set: patch },
        { returnDocument: 'after' }
      )
      .exec();
    if (!doc) {
      throw new Error('User not found');
    }
    return doc;
  }

  async setPhotoUrl(params: { userId: string; photoUrl: string | null }): Promise<UserDocument> {
    const doc = await this.userModel
      .findOneAndUpdate(
        { userId: params.userId },
        { $set: { photoUrl: params.photoUrl } },
        { returnDocument: 'after' }
      )
      .exec();
    if (!doc) {
      throw new Error('User not found');
    }
    return doc;
  }

  async changePassword(params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<'ok' | 'invalid_current'> {
    const doc = await this.userModel.findOne({ userId: params.userId }).exec();
    if (!doc) {
      return 'invalid_current';
    }
    const ok = await bcrypt.compare(params.currentPassword, doc.passwordHash);
    if (!ok) {
      return 'invalid_current';
    }
    doc.passwordHash = await bcrypt.hash(params.newPassword, 10);
    await doc.save();
    return 'ok';
  }

  /**
   * Creates the first super_admin when the user collection is empty.
   * Credentials from `options` override `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
   */
  async seedAdminUser(options?: {
    email?: string;
    password?: string;
    displayName?: string;
  }): Promise<SeedAdminUserResult> {
    const count = await this.userModel.countDocuments().exec();
    if (count > 0) {
      return { status: 'skipped', reason: 'users_exist' };
    }

    const email = (options?.email ?? process.env.SEED_ADMIN_EMAIL)?.trim();
    const password = options?.password ?? process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password) {
      return { status: 'skipped', reason: 'missing_credentials' };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.userModel.create({
      userId: randomUUID(),
      email: email.toLowerCase(),
      displayName: options?.displayName?.trim() || 'Seed Admin',
      passwordHash,
      role: 'super_admin',
    });
    return { status: 'created', email: email.toLowerCase() };
  }

  private async seedDefaultUser(): Promise<void> {
    const result = await this.seedAdminUser();
    if (result.status === 'created') {
      this.logger.log(`Seeded default admin user ${result.email}`);
      return;
    }
    if (result.reason === 'missing_credentials') {
      this.logger.warn(
        'No users in database — set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create an initial admin, or run: pnpm exec nx run openad-api:seed'
      );
    }
  }
}
