import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { User } from '../modules/auth/schemas/user.schema';
import { Device } from '../modules/devices/devices.schema';
import { Vehicle } from '../modules/vehicles/vehicles.schema';
import { FleetStatusRecord } from '../modules/vehicles/fleet-status.schema';
import { RedisService } from '../infrastructure/redis/redis.service';
import { AssetStorageService } from '../infrastructure/storage/asset-storage.service';
import { TestAppModule } from './test-app.module';
import { InMemoryAssetStorageService } from './in-memory-asset-storage.service';
import { getMongoTestBaseUri, getRedisTestUrl } from './memory-mongo';

export interface TestAppContext {
  app: INestApplication;
}

/**
 * MongoDB: Jest always uses `mongodb-memory-server` (ignores `MONGO_TEST_URI` from `.env` unless
 * `OPENAD_TEST_MONGO_INTEGRATION=true`). See `memory-mongo.ts` and `jest-global-setup.cjs`.
 * For non-Jest use, set `MONGO_TEST_URI` for Docker/host, or `MONGO_TEST_USE_MEMORY=false` for
 * `mongodb://127.0.0.1:27017`.
 *
 * Redis: uses `REDIS_TEST_URI`, then `REDIS_URL`, then `redis://127.0.0.1:6379` (Docker/local).
 * MQTT: defaults to localhost; mock `MqttService` in suites that must not connect.
 *
 * Each suite uses a unique database name and drops it on teardown.
 */
export async function createTestApp(): Promise<TestAppContext> {
  const host = await getMongoTestBaseUri();
  const dbName = `openad_api_jest_${randomUUID().replace(/-/g, '')}`;
  process.env.MONGO_URI = `${host.replace(/\/$/, '')}/${dbName}`;
  process.env.JWT_SECRET = 'test-jwt-secret-key-min-32-chars-long!!';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-min-32-chars!!';
  process.env.LOG_LEVEL = 'error';
  process.env.REDIS_URL = await getRedisTestUrl();
  const mqttUrl =
    process.env.MQTT_TEST_URI ??
    'mqtt://openad:openad-dev-mqtt@127.0.0.1:1884';
  process.env.MQTT_URL = mqttUrl;
  process.env.RABBITMQ_PROVISION_DEVICE_MQTT_USERS = 'false';
  process.env.MQTT_DEVICE_USER = '';
  process.env.MQTT_DEVICE_PASS = '';
  process.env.SYNC_ASSET_VERIFY_IN_TESTS = 'true';
  process.env.PUBLIC_ASSET_BASE_URL = 'http://127.0.0.1:3000';
  process.env.MQTT_HEALTH_DISABLED = 'true';
  process.env.SKIP_ASSET_ROTATION = 'true';
  process.env.MEDIA_STORAGE_BACKEND = 'memory';
  process.env.S3_BUCKET = 'test-media-bucket';
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY_ID = 'test';
  process.env.S3_SECRET_ACCESS_KEY = 'test';

  const moduleRef = await Test.createTestingModule({
    imports: [TestAppModule],
  })
    .overrideProvider(AssetStorageService)
    .useClass(InMemoryAssetStorageService)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );
  await app.init();

  const userModel = app.get(getModelToken(User.name));
  await userModel.create({
    userId: randomUUID(),
    email: 'fleet-op@test.local',
    passwordHash: await bcrypt.hash('testpass123', 4),
    displayName: 'Fleet Op',
    role: 'fleet_operator',
  });
  await userModel.create({
    userId: randomUUID(),
    email: 'fleet-admin@test.local',
    passwordHash: await bcrypt.hash('testpass123', 4),
    displayName: 'Fleet Admin',
    role: 'fleet_admin',
  });
  await userModel.create({
    userId: randomUUID(),
    email: 'campaign-mgr@test.local',
    passwordHash: await bcrypt.hash('testpass123', 4),
    displayName: 'Campaign Manager',
    role: 'campaign_manager',
  });
  await userModel.create({
    userId: randomUUID(),
    email: 'finance-analyst@test.local',
    passwordHash: await bcrypt.hash('testpass123', 4),
    displayName: 'Finance Analyst',
    role: 'finance_analyst',
  });
  await userModel.create({
    userId: randomUUID(),
    email: 'super-admin@test.local',
    passwordHash: await bcrypt.hash('testpass123', 4),
    displayName: 'Super Admin',
    role: 'super_admin',
  });

  return { app };
}

export async function loginAsCampaignManager(
  app: INestApplication
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: 'campaign-mgr@test.local', password: 'testpass123' });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

export async function loginAsFleetOperator(
  app: INestApplication
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: 'fleet-op@test.local', password: 'testpass123' });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

/** Device JWT (`typ: device`) for integration tests — optional `fp` when device has hardware fingerprint. */
export function signDeviceAccessToken(
  app: INestApplication,
  deviceId: string,
  options?: { fingerprintHash?: string }
): string {
  const jwt = app.get(JwtService);
  const payload: { sub: string; typ: 'device'; fp?: string } = {
    sub: deviceId,
    typ: 'device',
  };
  if (options?.fingerprintHash) {
    payload.fp = options.fingerprintHash;
  }
  return jwt.sign(payload, { expiresIn: '2h' });
}

export async function loginAsFleetAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: 'fleet-admin@test.local', password: 'testpass123' });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

export async function loginAsSuperAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: 'super-admin@test.local', password: 'testpass123' });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

export async function loginAsFinanceAnalyst(
  app: INestApplication
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: 'finance-analyst@test.local', password: 'testpass123' });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

export async function seedActiveVehicle(
  app: INestApplication,
  overrides: {
    vehicleId?: string;
    registrationPlate?: string;
    make?: string;
  } = {}
): Promise<string> {
  const vehicleModel = app.get(getModelToken(Vehicle.name));
  const vehicleId = overrides.vehicleId ?? randomUUID();
  await vehicleModel.create({
    vehicleId,
    registrationPlate:
      overrides.registrationPlate ?? `REG-${randomUUID().slice(0, 8)}`,
    make: overrides.make ?? 'Acme',
    model: 'Transit',
    year: 2024,
    status: 'active',
    pairedDeviceIds: [],
    commercialTier: 'other',
    driverId: null,
    inShop: false,
    operatorId: randomUUID(),
    characteristics: { screenCount: 1, passengerCapacity: 4 },
    decommissionedAt: null,
  });
  return vehicleId;
}

/**
 * Creates a bound device + fleet_status row for fleet/command tests (mirrors device bind semantics).
 */
export async function seedBoundDeviceForVehicle(
  app: INestApplication,
  vehicleId: string
): Promise<{ deviceId: string }> {
  const deviceId = randomUUID();
  const serialNumber = `SN-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const deviceModel = app.get(getModelToken(Device.name));
  const vehicleModel = app.get(getModelToken(Vehicle.name));
  const totalGb = 32;
  const reportedAt = now.toISOString();
  await deviceModel.create({
    deviceId,
    serialNumber,
    lifecycleState: 'Active',
    groupId: null,
    boundVehicleId: vehicleId,
    boundAt: now,
    hardwareProfile: {
      screenWidthPx: 1920,
      screenHeightPx: 1080,
      screenSizeInches: 10,
      osVersion: 'test',
      storageCapacityGb: totalGb,
    },
    capabilityManifest: {
      screenWidthPx: 1920,
      screenHeightPx: 1080,
      screenSizeInches: 10,
      totalStorageGb: totalGb,
      availableStorageGb: totalGb,
      osVersion: 'test',
      appVersion: '0.0.0',
      reportedAt,
    },
    mqttClientId: deviceId,
    certificateThumbprint: 'a'.repeat(64),
    lastSeenAt: now,
    lastHealthMetrics: null,
  });
  await vehicleModel.updateOne(
    { vehicleId },
    { $set: { pairedDeviceIds: [deviceId] } }
  );

  const fleetModel = app.get(getModelToken(FleetStatusRecord.name));
  await fleetModel.create({
    deviceId,
    vehicleId,
    reportedAt: now,
    location: { type: 'Point', coordinates: [-0.1278, 51.5074] },
    connectivity: { status: 'online' },
    playback: { status: 'idle', currentCampaignId: null },
    alertFlags: [],
  });
  return { deviceId };
}

export async function shutdownTestApp(
  ctx: TestAppContext | undefined
): Promise<void> {
  if (!ctx?.app) {
    return;
  }
  try {
    const redis = ctx.app.get(RedisService);
    await redis.getClient().flushall();
  } catch {
    /* ignore teardown races */
  }
  const conn = ctx.app.get<Connection>(getConnectionToken());
  await conn.dropDatabase();
  await ctx.app.close();
}
