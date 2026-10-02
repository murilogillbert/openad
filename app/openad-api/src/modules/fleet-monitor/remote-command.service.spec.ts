import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  COMMAND_DISPATCH_JOB,
  RemoteCommandService,
} from './remote-command.service';
import type { DevicesRepository } from '../devices/devices.repository';
import type { RemoteCommandsRepository } from './remote-commands.repository';
import type { RedisService } from '../../infrastructure/redis/redis.service';

describe('RemoteCommandService', () => {
  const logger: Pick<PinoLogger, 'setContext' | 'info'> = {
    setContext: jest.fn(),
    info: jest.fn(),
  };

  const devices = {
    findByDeviceId: jest.fn(),
  } as unknown as jest.Mocked<DevicesRepository>;

  const commands = {
    create: jest.fn(),
    findByDeviceId: jest.fn(),
  } as unknown as jest.Mocked<RemoteCommandsRepository>;

  const redis = {
    xadd: jest.fn(),
  } as unknown as jest.Mocked<RedisService>;

  const storage = {
    getPresignedGetUrl: jest.fn(),
  } as unknown as import('../../infrastructure/storage/asset-storage.service').AssetStorageService;

  const dispatchQueue = {
    add: jest.fn(),
  } as unknown as jest.Mocked<Queue>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queues command when device is bound', async () => {
    devices.findByDeviceId.mockResolvedValue({
      deviceId: 'dev-1',
      boundVehicleId: 'veh-1',
    } as never);
    commands.create.mockResolvedValue({} as never);
    redis.xadd.mockResolvedValue('1-0');
    dispatchQueue.add.mockResolvedValue({} as never);

    const svc = new RemoteCommandService(
      logger as PinoLogger,
      devices,
      commands,
      storage,
      redis,
      dispatchQueue
    );

    const out = await svc.issue(
      'dev-1',
      { type: 'RESTART', payload: null },
      'user-1'
    );

    expect(out.status).toBe('Pending');
    expect(commands.create).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'dev-1',
        status: 'Pending',
        type: 'RESTART',
        issuedByUserId: 'user-1',
      })
    );
    expect(redis.xadd).toHaveBeenCalledWith(
      'stream:commands',
      '*',
      'commandId',
      out.commandId,
      'deviceId',
      'dev-1'
    );
    expect(dispatchQueue.add).toHaveBeenCalledWith(
      COMMAND_DISPATCH_JOB,
      { commandId: out.commandId },
      { removeOnComplete: true }
    );
  });

  it('GET_SCREENSHOT embeds upload URL and deadline in payload', async () => {
    devices.findByDeviceId.mockResolvedValue({
      deviceId: 'dev-1',
      boundVehicleId: 'veh-1',
    } as never);
    commands.create.mockResolvedValue({} as never);
    redis.xadd.mockResolvedValue('1-0');
    dispatchQueue.add.mockResolvedValue({} as never);

    const svc = new RemoteCommandService(
      logger as PinoLogger,
      devices,
      commands,
      storage,
      redis,
      dispatchQueue
    );

    await svc.issue('dev-1', { type: 'GET_SCREENSHOT', payload: null }, null);

    expect(commands.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GET_SCREENSHOT',
        payload: expect.objectContaining({
          uploadUrl: expect.stringContaining(
            '/api/v1/devices/dev-1/commands/screenshots/'
          ),
          deadlineAt: expect.any(String),
        }),
      })
    );
  });

  it('rejects UPGRADE_APP when apk URL unreachable', async () => {
    devices.findByDeviceId.mockResolvedValue({
      deviceId: 'dev-1',
      boundVehicleId: 'veh-1',
    } as never);
    global.fetch = jest.fn().mockResolvedValue({ status: 404 }) as never;

    const svc = new RemoteCommandService(
      logger as PinoLogger,
      devices,
      commands,
      storage,
      redis,
      dispatchQueue
    );

    await expect(
      svc.issue(
        'dev-1',
        {
          type: 'UPGRADE_APP',
          payload: { apkUrl: 'https://example.invalid/no-apk' },
        },
        null
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when device missing', async () => {
    devices.findByDeviceId.mockResolvedValue(null);
    const svc = new RemoteCommandService(
      logger as PinoLogger,
      devices,
      commands,
      storage,
      redis,
      dispatchQueue
    );
    await expect(
      svc.issue('missing', { type: 'RESTART', payload: null }, null)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when device unbound', async () => {
    devices.findByDeviceId.mockResolvedValue({
      deviceId: 'dev-1',
      boundVehicleId: null,
    } as never);
    const svc = new RemoteCommandService(
      logger as PinoLogger,
      devices,
      commands,
      storage,
      redis,
      dispatchQueue
    );
    await expect(
      svc.issue('dev-1', { type: 'RESTART', payload: null }, null)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects SET_VOLUME without level', async () => {
    devices.findByDeviceId.mockResolvedValue({
      deviceId: 'dev-1',
      boundVehicleId: 'veh-1',
    } as never);
    const svc = new RemoteCommandService(
      logger as PinoLogger,
      devices,
      commands,
      storage,
      redis,
      dispatchQueue
    );
    await expect(
      svc.issue('dev-1', { type: 'SET_VOLUME', payload: {} }, null)
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
