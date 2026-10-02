import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { VehiclesRepository } from '../vehicles/vehicles.repository';
import { DevicesRepository } from './devices.repository';
import { DevicesListService } from './devices-list.service';

const audit: FleetAuditContext = {
  correlationId: 'c1',
  operatorUserId: 'u1',
  operatorEmail: 'op@test',
  operatorRole: 'fleet_operator',
};

describe('DevicesListService', () => {
  it('maps devices with bound vehicle plate', async () => {
    const vid = randomUUID();
    const devices = {
      findMany: jest.fn().mockResolvedValue([
        {
          deviceId: 'd1',
          serialNumber: 'SN-1',
          lifecycleState: 'Active',
          lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
          boundVehicleId: vid,
        },
      ]),
      countDocuments: jest.fn().mockResolvedValue(1),
    };
    const vehicles = {
      findMany: jest.fn().mockResolvedValue([
        { vehicleId: vid, registrationPlate: 'PLATE-99' },
      ]),
    };

    const module = await Test.createTestingModule({
      providers: [
        DevicesListService,
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn() },
        },
        { provide: DevicesRepository, useValue: devices },
        { provide: VehiclesRepository, useValue: vehicles },
      ],
    }).compile();

    const svc = module.get(DevicesListService);
    const res = await svc.findAll({ page: 1, limit: 10 }, audit);

    expect(res.data).toHaveLength(1);
    expect(res.data[0].boundVehicleRegistrationPlate).toBe('PLATE-99');
    expect(res.pagination.total).toBe(1);
  });
});
