import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import {
  createTestApp,
  loginAsFleetAdmin,
  loginAsFleetOperator,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../test-app.factory';
import { Device } from '../../modules/devices/devices.schema';
import { DeviceStateMachineService } from '../../modules/devices/device-state-machine.service';

describe('PATCH /api/v1/devices/:deviceId/state (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await shutdownTestApp(ctx);
  }, 30_000);

  it('Active → Suspended by admin returns 200 with eventId', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/devices/${deviceId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        toState: 'Suspended',
        reason: 'Administrative suspension for testing purposes',
      });

    expect(res.status).toBe(200);
    expect(res.body.eventId).toBeTruthy();
    expect(res.body.fromState).toBe('Active');
    expect(res.body.toState).toBe('Suspended');
  });

  it('Active → Retired by admin returns 200', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/devices/${deviceId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        toState: 'Retired',
        reason: 'End of life for this device - testing only',
      });

    expect(res.status).toBe(200);
    expect(res.body.toState).toBe('Retired');
  });

  it('Pending → Suspended returns 400 INVALID_TRANSITION (DTO allows only admin target states)', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const deviceModel = ctx.app.get(getModelToken(Device.name));
    await deviceModel.updateOne(
      { deviceId },
      { $set: { lifecycleState: 'Pending' } }
    );

    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/devices/${deviceId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        toState: 'Suspended',
        reason: 'Pending cannot jump to Suspended in the transition matrix',
      });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_TRANSITION');
  });

  it('request for retired UUID returns 403 (blacklist)', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const fsm = ctx.app.get(DeviceStateMachineService);
    await fsm.transitionTo(deviceId, 'Retired', {
      type: 'admin',
      detail: 'retire for blacklist guard test',
      actorId: 'admin-test',
    });

    const token = await loginAsFleetAdmin(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/devices/${deviceId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        toState: 'Suspended',
        reason: 'Should be blocked by RetiredDeviceGuard before FSM',
      });

    expect(res.status).toBe(403);
  });

  it('non-admin role returns 403', async () => {
    const vehicleId = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, vehicleId);
    const token = await loginAsFleetOperator(ctx.app);
    const res = await request(ctx.app.getHttpServer())
      .patch(`/api/v1/devices/${deviceId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        toState: 'Suspended',
        reason: 'Fleet operator should not change lifecycle state',
      });

    expect(res.status).toBe(403);
  });
});
