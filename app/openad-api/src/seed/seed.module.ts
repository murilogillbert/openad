import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { validateEnv } from '../app/env.validation';
import { MongodbModule } from '../infrastructure/mongodb/mongodb.module';
import { RabbitmqModule } from '../infrastructure/rabbitmq/rabbitmq.module';
import { RabbitmqApiMqttUserSeedService } from '../infrastructure/rabbitmq/rabbitmq-api-mqtt-user-seed.service';
import { User, UserSchema } from '../modules/auth/schemas/user.schema';
import { UsersService } from '../modules/auth/users.service';

/**
 * Minimal Nest context for `scripts/seed-admin.ts`: same `ConfigModule` + validation as
 * {@link AppModule} (public repo root `.env*` + `app/openad-api/.env*` via
 * `with-monorepo-env.sh app openad-api` — not `docker/.env*`), plus
 * MongoDB and RabbitMQ management only — no MQTT client, Redis, Bull, feature modules, etc.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    MongodbModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    RabbitmqModule,
  ],
  providers: [UsersService, RabbitmqApiMqttUserSeedService],
})
export class SeedModule {}
