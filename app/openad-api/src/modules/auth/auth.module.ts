import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';
import { AdminProfileController } from './admin-profile.controller';
import { AdminSessionsController } from './admin-sessions.controller';
import { AdminSession, AdminSessionSchema } from './schemas/admin-session.schema';
import { AdminSessionsService } from './admin-sessions.service';
import { AdminSessionsRepository } from './admin-sessions.repository';
import {
  SecurityAuditEvent,
  SecurityAuditEventSchema,
} from './schemas/security-audit-event.schema';
import { SecurityAuditService } from './security-audit.service';
import { AssetStorageModule } from '../../infrastructure/storage/storage.module';

@Module({
  imports: [
    AssetStorageModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AdminSession.name, schema: AdminSessionSchema },
      { name: SecurityAuditEvent.name, schema: SecurityAuditEventSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: async () => {
        const s = (process.env.JWT_SECRET ?? '').trim();
        if (!s) {
          throw new Error('JWT_SECRET is required');
        }
        return { secret: s, signOptions: { expiresIn: '15m' } };
      },
    }),
  ],
  controllers: [AuthController, AdminProfileController, AdminSessionsController],
  providers: [
    AuthService,
    UsersService,
    AdminSessionsRepository,
    AdminSessionsService,
    SecurityAuditService,
    JwtStrategy,
  ],
  exports: [AuthService, JwtModule, UsersService, SecurityAuditService],
})
export class AuthModule {}
