import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import type { DeviceLifecycleState } from '@openad/domain';
import { DeviceLifecycleEventRepository } from './device-lifecycle-event.repository';
import { RetiredDeviceRegistryRepository } from './retired-device-registry.repository';
import { DeviceStateMachineService } from './device-state-machine.service';
import { DevicesRepository } from './devices.repository';
import { InvalidTransitionException } from './invalid-transition.exception';
import type { DeviceDocument } from './devices.schema';

const STATES: DeviceLifecycleState[] = [
  'Pending',
  'Active',
  'Flagged',
  'Suspended',
  'Retired',
];

const VALID = new Set<string>([
  'Pending,Active',
  'Pending,Retired',
  'Active,Flagged',
  'Active,Suspended',
  'Active,Retired',
  'Flagged,Active',
  'Flagged,Suspended',
  'Flagged,Retired',
  'Suspended,Active',
  'Suspended,Retired',
]);

function makeDevice(lifecycleState: DeviceLifecycleState): DeviceDocument {
  return {
    deviceId: 'dev-1',
    serialNumber: 'sn',
    lifecycleState,
    boundVehicleId: 'v1',
    boundAt: new Date(),
    lastSeenAt: new Date(),
  } as DeviceDocument;
}

const INVALID_PAIRS: [DeviceLifecycleState, DeviceLifecycleState][] = (() => {
  const out: [DeviceLifecycleState, DeviceLifecycleState][] = [];
  for (const from of STATES) {
    for (const to of STATES) {
      if (VALID.has(`${from},${to}`)) continue;
      out.push([from, to]);
    }
  }
  return out;
})();

describe('DeviceStateMachineService', () => {
  let service: DeviceStateMachineService;
  let devices: { findByDeviceId: jest.Mock; updateOne: jest.Mock };
  let lifecycleEvents: { create: jest.Mock };
  let retired: { insert: jest.Mock };

  beforeEach(async () => {
    devices = { findByDeviceId: jest.fn(), updateOne: jest.fn() };
    lifecycleEvents = { create: jest.fn() };
    retired = { insert: jest.fn() };

    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        DeviceStateMachineService,
        { provide: PinoLogger, useValue: logger },
        { provide: DevicesRepository, useValue: devices },
        { provide: DeviceLifecycleEventRepository, useValue: lifecycleEvents },
        { provide: RetiredDeviceRegistryRepository, useValue: retired },
      ],
    }).compile();

    service = module.get(DeviceStateMachineService);
    devices.updateOne.mockResolvedValue({});
    lifecycleEvents.create.mockResolvedValue({});
    retired.insert.mockResolvedValue({});
  });

  const systemTrigger = { type: 'system' as const, detail: 'test' };

  it('throws NotFoundException when device missing', async () => {
    devices.findByDeviceId.mockResolvedValue(null);
    await expect(
      service.transitionTo('missing', 'Active', systemTrigger)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  const validCases: [DeviceLifecycleState, DeviceLifecycleState][] = [
    ['Pending', 'Active'],
    ['Pending', 'Retired'],
    ['Active', 'Flagged'],
    ['Active', 'Suspended'],
    ['Active', 'Retired'],
    ['Flagged', 'Active'],
    ['Flagged', 'Suspended'],
    ['Flagged', 'Retired'],
    ['Suspended', 'Active'],
    ['Suspended', 'Retired'],
  ];

  describe('valid transitions (matrix)', () => {
    it.each(validCases)(
      'allows %s → %s',
      async (from, to) => {
        devices.findByDeviceId.mockResolvedValue(makeDevice(from));
        const result = await service.transitionTo('dev-1', to, {
          type: 'admin',
          detail: 'administrative action',
          actorId: 'admin-1',
        });
        expect(result.fromState).toBe(from);
        expect(result.toState).toBe(to);
        expect(devices.updateOne).toHaveBeenCalled();
        expect(lifecycleEvents.create).toHaveBeenCalled();
        if (to === 'Retired') {
          expect(retired.insert).toHaveBeenCalledWith(
            expect.objectContaining({
              deviceId: 'dev-1',
              retiredByAdminId: 'admin-1',
            })
          );
        } else {
          expect(retired.insert).not.toHaveBeenCalled();
        }
      }
    );
  });

  describe('invalid transitions', () => {
    it.each(INVALID_PAIRS)(
      'rejects %s → %s',
      async (from, to) => {
        devices.findByDeviceId.mockResolvedValue(makeDevice(from));
        await expect(
          service.transitionTo('dev-1', to, systemTrigger)
        ).rejects.toBeInstanceOf(InvalidTransitionException);
      }
    );
  });
});
