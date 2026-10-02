import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { RabbitmqTabletCredentialsService } from '../../infrastructure/rabbitmq/rabbitmq-tablet-credentials.service';
import { DevicesRepository } from './devices.repository';
import { PairingAuditService } from './pairing-audit.service';
import { PairingService } from './pairing.service';
import {
  hardwareFingerprintHash,
  type HardwareFingerprintInput,
} from './hardware-fingerprint.util';
import { PairingRequestRecord } from './schemas/pairing-request.schema';
import { PairingSecretRecord } from './schemas/pairing-secret.schema';

function fpInput(): HardwareFingerprintInput {
  return {
    imei: null,
    serialNumber: 'SN-PAIR-TEST',
    macAddress: 'AA:BB:CC:DD:EE:01',
  };
}

describe('PairingService', () => {
  let svc: PairingService;
  let devices: jest.Mocked<
    Pick<DevicesRepository, 'create' | 'findByDeviceId' | 'findBySerial' | 'updateOne'>
  >;
  let pairingRequests: { create: jest.Mock; findOne: jest.Mock };
  let pairingSecrets: { create: jest.Mock; find: jest.Mock; findOne: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    devices = {
      create: jest.fn().mockResolvedValue({}),
      findByDeviceId: jest.fn(),
      findBySerial: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    pairingRequests = {
      create: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
    };
    pairingSecrets = {
      create: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue({ exec: () => Promise.resolve([]) }),
      findOne: jest.fn(),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PairingService,
        { provide: PinoLogger, useValue: { setContext: jest.fn(), info: jest.fn() } },
        { provide: DevicesRepository, useValue: devices },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('jwt-token') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string) => {
              if (k === 'MQTT_URL') return 'mqtt://127.0.0.1:1883';
              if (k === 'PORT') return '3000';
              return '';
            }),
          },
        },
        { provide: PairingAuditService, useValue: audit },
        {
          provide: RabbitmqTabletCredentialsService,
          useValue: {
            provisioningEnabled: () => false,
            provision: jest.fn(),
            deleteForDevice: jest.fn(),
          },
        },
        {
          provide: getModelToken(PairingRequestRecord.name),
          useValue: pairingRequests,
        },
        {
          provide: getModelToken(PairingSecretRecord.name),
          useValue: pairingSecrets,
        },
      ],
    }).compile();

    svc = moduleRef.get(PairingService);
  });

  it('register stores hashed fingerprint via pairing request + device', async () => {
    const h = fpInput();
    const expectedHash = hardwareFingerprintHash(h);
    await svc.register({ hardwareFingerprint: h });

    expect(pairingRequests.create).toHaveBeenCalledWith(
      expect.objectContaining({
        hardwareFingerprintHash: expectedHash,
        status: 'Pending',
      })
    );
    expect(devices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        hardwareFingerprintHash: expectedHash,
      })
    );
  });

  it('registerInventoryDevice creates pending device with serial-only fingerprint', async () => {
    await svc.registerInventoryDevice({ serialNumber: 'INV-SN-001' });

    expect(devices.findBySerial).toHaveBeenCalledWith('INV-SN-001');
    expect(pairingRequests.create).toHaveBeenCalled();
    expect(devices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serialNumber: 'INV-SN-001',
        lifecycleState: 'Pending',
        hardwareProfile: expect.objectContaining({
          screenWidthPx: 0,
          screenHeightPx: 0,
        }),
      })
    );
  });

  it('bind rejects fingerprint mismatch', async () => {
    const h = fpInput();
    devices.findByDeviceId.mockResolvedValue({
      hardwareFingerprintHash: hardwareFingerprintHash(h),
      lastManifestVersion: 0,
    } as never);
    pairingRequests.findOne.mockReturnValue({
      exec: () =>
        Promise.resolve({
          requestId: 'req-1',
          status: 'Pending',
        }),
    });

    await expect(
      svc.bind({
        deviceId: 'd1',
        hardwareFingerprint: { ...h, serialNumber: 'OTHER' },
        secretCode: 'ABCD1234',
      })
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'hardware_mismatch' })
    );
  });
});
