import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  createTestApp,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../../test/test-app.factory';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { ConfigurationProfilesRepository } from '../configuration-profiles/configuration-profiles.repository';
import { ConfigurationProfilesService } from '../configuration-profiles/configuration-profiles.service';
import { DeviceGroupsService } from './device-groups.service';

describe('DeviceGroupsService (integration)', () => {
  let ctx: TestAppContext;
  let svc: DeviceGroupsService;
  let profiles: ConfigurationProfilesRepository;
  let profileSvc: ConfigurationProfilesService;
  let publishSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = await createTestApp();
    svc = ctx.app.get(DeviceGroupsService);
    profiles = ctx.app.get(ConfigurationProfilesRepository);
    profileSvc = ctx.app.get(ConfigurationProfilesService);
    const mqtt = ctx.app.get(MqttService);
    publishSpy = jest
      .spyOn(mqtt, 'publishDeviceConfig')
      .mockResolvedValue(undefined);
  }, 120_000);

  afterEach(() => {
    publishSpy?.mockClear();
  });

  afterAll(async () => {
    publishSpy?.mockRestore();
    await shutdownTestApp(ctx);
  }, 30_000);

  it('create saves group when profile exists', async () => {
    const def = await profiles.findDefault();
    expect(def).toBeTruthy();
    const g = await svc.create({
      name: `Grp-${randomUUID().slice(0, 8)}`,
      profileId: def!.profileId,
    });
    const found = await svc.findById(g.groupId);
    expect(found.profileId).toBe(def!.profileId);
    expect(found.memberCount).toBe(0);
  });

  it('create with unknown profileId throws NotFoundException', async () => {
    await expect(
      svc.create({
        name: `X-${randomUUID().slice(0, 8)}`,
        profileId: randomUUID(),
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateMembers assigns groupId and publishes config per device', async () => {
    const def = await profiles.findDefault();
    const g = await svc.create({
      name: `Mem-${randomUUID().slice(0, 8)}`,
      profileId: def!.profileId,
    });
    const v1 = await seedActiveVehicle(ctx.app);
    const v2 = await seedActiveVehicle(ctx.app);
    const v3 = await seedActiveVehicle(ctx.app);
    const a = await seedBoundDeviceForVehicle(ctx.app, v1);
    const b = await seedBoundDeviceForVehicle(ctx.app, v2);
    const c = await seedBoundDeviceForVehicle(ctx.app, v3);
    publishSpy.mockClear();

    const res = await svc.updateMembers(g.groupId, [
      a.deviceId,
      b.deviceId,
      c.deviceId,
    ]);

    expect(res.addedDeviceIds.length).toBe(3);
    expect(res.triggeredConfigSync).toBe(true);
    expect(res.configSyncComplete?.deviceCount).toBe(3);
    expect(publishSpy).toHaveBeenCalledTimes(3);
    const ids = publishSpy.mock.calls.map((call) => call[0] as string).sort();
    expect(ids).toEqual(
      [a.deviceId, b.deviceId, c.deviceId].sort()
    );
  });

  it('update group profileId pushes config to all members', async () => {
    const extra = await profileSvc.create({
      name: `Extra-${randomUUID().slice(0, 8)}`,
      exhibitionRules: { maxLoopLengthSeconds: 200, adToContentRatio: 2 },
      connectivityMode: 'Premium',
      commercialTierMultiplier: 1.5,
    });
    const g = await svc.create({
      name: `ProfChg-${randomUUID().slice(0, 8)}`,
      profileId: extra.profileId,
    });
    const v = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, v);
    await svc.updateMembers(g.groupId, [deviceId]);
    publishSpy.mockClear();

    const def = await profiles.findDefault();
    await svc.update(g.groupId, { profileId: def!.profileId });

    expect(publishSpy).toHaveBeenCalledWith(
      deviceId,
      expect.objectContaining({ profileId: def!.profileId })
    );
  });

  it('duplicate group name throws ConflictException', async () => {
    const def = await profiles.findDefault();
    const name = `Same-${randomUUID().slice(0, 8)}`;
    await svc.create({ name, profileId: def!.profileId });
    await expect(
      svc.create({ name, profileId: def!.profileId })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
