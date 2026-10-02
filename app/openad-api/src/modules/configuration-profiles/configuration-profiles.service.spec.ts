import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  createTestApp,
  seedActiveVehicle,
  seedBoundDeviceForVehicle,
  shutdownTestApp,
  type TestAppContext,
} from '../../test/test-app.factory';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { ConfigurationProfilesService } from './configuration-profiles.service';
import { DeviceGroupsService } from '../device-groups/device-groups.service';
import { ConfigurationProfilesRepository } from './configuration-profiles.repository';

const baseDto = {
  name: `Profile-${randomUUID().slice(0, 8)}`,
  exhibitionRules: { maxLoopLengthSeconds: 120, adToContentRatio: 3 },
  connectivityMode: 'Economy' as const,
  commercialTierMultiplier: 1,
};

describe('ConfigurationProfilesService (integration)', () => {
  let ctx: TestAppContext;
  let svc: ConfigurationProfilesService;
  let groups: DeviceGroupsService;
  let profilesRepo: ConfigurationProfilesRepository;
  let publishSpy: jest.SpyInstance;

  beforeAll(async () => {
    ctx = await createTestApp();
    svc = ctx.app.get(ConfigurationProfilesService);
    groups = ctx.app.get(DeviceGroupsService);
    profilesRepo = ctx.app.get(ConfigurationProfilesRepository);
    const mqtt = ctx.app.get(MqttService);
    publishSpy = jest
      .spyOn(mqtt, 'publishDeviceConfig')
      .mockResolvedValue(undefined);
  }, 120_000);

  afterEach(() => {
    publishSpy.mockClear();
  });

  afterAll(async () => {
    publishSpy.mockRestore();
    await shutdownTestApp(ctx);
  }, 30_000);

  it('create persists profile', async () => {
    const created = await svc.create({
      ...baseDto,
      name: `Persist-${randomUUID().slice(0, 8)}`,
    });
    const again = await svc.findById(created.profileId);
    expect(again.name).toBe(created.name);
    expect(again.exhibitionRules.adToContentRatio).toBe(3);
  });

  it('create duplicate name throws ConflictException', async () => {
    const name = `Dup-${randomUUID().slice(0, 8)}`;
    await svc.create({ ...baseDto, name });
    try {
      await svc.create({ ...baseDto, name });
      throw new Error('expected duplicate create to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = (e as ConflictException).getResponse() as { code: string };
      expect(body.code).toBe('PROFILE_NAME_CONFLICT');
    }
  });

  it('delete default profile throws ConflictException', async () => {
    const def = await profilesRepo.findDefault();
    expect(def).toBeTruthy();
    await expect(svc.delete(def!.profileId)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('delete non-default reassigns groups to default and republishes config', async () => {
    const def = await profilesRepo.findDefault();
    const created = await svc.create({
      ...baseDto,
      name: `Del-${randomUUID().slice(0, 8)}`,
    });
    const g = await groups.create({
      name: `G-${randomUUID().slice(0, 8)}`,
      profileId: created.profileId,
    });
    const v1 = await seedActiveVehicle(ctx.app);
    const v2 = await seedActiveVehicle(ctx.app);
    const { deviceId: d1 } = await seedBoundDeviceForVehicle(ctx.app, v1);
    const { deviceId: d2 } = await seedBoundDeviceForVehicle(ctx.app, v2);
    await groups.updateMembers(g.groupId, [d1, d2]);
    publishSpy.mockClear();

    await svc.delete(created.profileId);

    const updated = await groups.findById(g.groupId);
    expect(updated.profileId).toBe(def!.profileId);
    expect(publishSpy).toHaveBeenCalled();
    const publishedIds = publishSpy.mock.calls.map((c) => c[0] as string);
    expect(publishedIds).toEqual(expect.arrayContaining([d1, d2]));
  });

  it('update pushes MQTT config to devices in groups using this profile', async () => {
    const created = await svc.create({
      ...baseDto,
      name: `Push-${randomUUID().slice(0, 8)}`,
    });
    const g = await groups.create({
      name: `G2-${randomUUID().slice(0, 8)}`,
      profileId: created.profileId,
    });
    const v = await seedActiveVehicle(ctx.app);
    const { deviceId } = await seedBoundDeviceForVehicle(ctx.app, v);
    await groups.updateMembers(g.groupId, [deviceId]);
    publishSpy.mockClear();

    await svc.update(created.profileId, { connectivityMode: 'Premium' });

    expect(publishSpy).toHaveBeenCalledWith(
      deviceId,
      expect.objectContaining({
        profileId: created.profileId,
        connectivityMode: 'Premium',
      })
    );
  });
});
