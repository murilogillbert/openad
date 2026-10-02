/**
 * Standalone seed: RabbitMQ API MQTT user (from MQTT_URL / MQTT_USERNAME+PASSWORD) + initial
 * super_admin when the users collection is empty (same rules as API boot-time seed).
 *
 * Uses `SeedModule` only (Mongo + RabbitMQ management + config), not the full HTTP `AppModule`.
 *
 * Env: public root `.env*` + `app/openad-api/.env*` (`pnpm run api:seed`); never `docker/.env*`.
 *
 * Usage:
 *   pnpm run api:seed
 *   pnpm exec nx run openad-api:seed -- --email=admin@example.com --password='secret'
 */
import { NestFactory } from '@nestjs/core';
import { SeedModule } from '../src/seed/seed.module';
import { UsersService } from '../src/modules/auth/users.service';
import { RabbitmqApiMqttUserSeedService } from '../src/infrastructure/rabbitmq/rabbitmq-api-mqtt-user-seed.service';

function parseSeedArgs(argv: string[]): {
  email?: string;
  password?: string;
  displayName?: string;
} {
  const out: { email?: string; password?: string; displayName?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if ((a === '--email' || a === '-e') && next) {
      out.email = next;
      i++;
    } else if ((a === '--password' || a === '-p') && next) {
      out.password = next;
      i++;
    } else if ((a === '--display-name' || a === '-n') && next) {
      out.displayName = next;
      i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  process.env.SEED_STANDALONE = 'true';

  const overrides = parseSeedArgs(process.argv);
  const useOverrides = Boolean(
    overrides.email || overrides.password || overrides.displayName
  );

  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const rabbitSeed = app.get(RabbitmqApiMqttUserSeedService);
    const mqttR = await rabbitSeed.ensureApiMqttUser();
    if (mqttR.status === 'provisioned') {
      // eslint-disable-next-line no-console
      console.log(
        `RabbitMQ: ensured API MQTT user "${mqttR.username}" (topic + vhost permissions).`
      );
    } else if (mqttR.reason === 'same_as_management_user') {
      // eslint-disable-next-line no-console
      console.log(
        'RabbitMQ: skipped management API (MQTT client user equals MQTT_MANAGEMENT_USER; Docker default already has full access).'
      );
    }

    const users = app.get(UsersService);
    const result = await users.seedAdminUser(
      useOverrides ? overrides : undefined
    );

    if (result.status === 'created') {
      // eslint-disable-next-line no-console
      console.log(`Created initial admin: ${result.email}`);
      return;
    }
    if (result.reason === 'users_exist') {
      // eslint-disable-next-line no-console
      console.log('Skipped: at least one user already exists.');
      return;
    }
    // eslint-disable-next-line no-console
    console.error(
      'Missing credentials. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, or pass --email and --password.'
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
