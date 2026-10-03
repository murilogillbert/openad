import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  ECOSSISTEMA_AUDIENCE,
  ECOSSISTEMA_ISSUER,
  ESTRATEGIA_INTERNA,
} from './ecosystem-token';
import { FederatedIdentityService } from './federated-identity.service';
import { InternalJwtStrategy } from './strategies/internal-jwt.strategy';
import { FederatedJwtStrategy } from './strategies/federated-jwt.strategy';
import { EcosystemJwtStrategy } from './strategies/ecosystem-jwt.strategy';
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
    PassportModule.register({ defaultStrategy: ESTRATEGIA_INTERNA }),
    JwtModule.registerAsync({
      useFactory: async () => {
        const s = (process.env.JWT_SECRET ?? '').trim();
        if (!s) {
          throw new Error('JWT_SECRET is required');
        }
        return {
          secret: s,
          signOptions: {
            expiresIn: '15m',
            /**
             * `issuer` e `audience` entram aqui para que o token do openad tenha a mesma
             * forma do token do hub e do opendriver.
             *
             * **Ordem obrigatoria de implantacao:** assinar com os dois campos tem de ir ao
             * ar *antes* de qualquer verificacao exigi-los. Um token antigo nao os tem, e o
             * refresh do openad dura 30 dias — inverter a ordem invalidaria todas as sessoes
             * vivas do portal e dos tablets de uma vez. Por isso a estrategia interna aceita
             * token sem `iss`/`aud` durante a janela de transicao.
             */
            issuer: ECOSSISTEMA_ISSUER,
            audience: ECOSSISTEMA_AUDIENCE,
          },
        };
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
    FederatedIdentityService,
    InternalJwtStrategy,
    FederatedJwtStrategy,
    EcosystemJwtStrategy,
  ],
  exports: [
    AuthService,
    JwtModule,
    UsersService,
    SecurityAuditService,
    FederatedIdentityService,
  ],
})
export class AuthModule {}
