import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  createTestApp,
  loginAsSuperAdmin,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';
import { SecurityAuditEvent } from '../../modules/auth/schemas/security-audit-event.schema';

describe('Force update check audit (contract)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('records audit event with actor + deviceId metadata', async () => {
    const token = await loginAsSuperAdmin(ctx.app);
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);

    const res = await request(ctx.app.getHttpServer())
      .post(
        `/api/v1/releases/devices/${encodeURIComponent(deviceId)}/commands/check-app-updates`
      )
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);

    const model = ctx.app.get<Model<SecurityAuditEvent>>(
      getModelToken(SecurityAuditEvent.name)
    );
    const rows = await model.find({ action: 'release.force_update_check' }).lean().exec();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r: any) => r.subjectId === deviceId)).toBe(true);
    expect(rows.some((r: any) => r.metadata?.deviceId === deviceId)).toBe(true);
  });
});

