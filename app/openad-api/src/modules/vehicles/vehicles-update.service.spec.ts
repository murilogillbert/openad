import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { VehiclesRepository } from './vehicles.repository';
import { VehiclesQueryService } from './vehicles-query.service';
import { VehiclesUpdateService } from './vehicles-update.service';

const audit: FleetAuditContext = {
  correlationId: 'c1',
  operatorUserId: 'u1',
  operatorEmail: 'op@test',
  operatorRole: 'fleet_admin',
};

describe('VehiclesUpdateService', () => {
  it('applies inShop and driverId patches', async () => {
    const vehicleId = randomUUID();
    const driverId = randomUUID();
    const vehicles = {
      findByVehicleId: jest.fn().mockResolvedValue({
        vehicleId,
        characteristics: { screenCount: 1, passengerCapacity: 4 },
      }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    const detail = {
      vehicleId,
      inShop: true,
      driverId,
      bindingStatus: 'in_shop',
      pairedDeviceIds: [],
      commercialTier: 'other',
    };
    const query = {
      findOne: jest.fn().mockResolvedValue(detail),
    };

    const module = await Test.createTestingModule({
      providers: [
        VehiclesUpdateService,
        { provide: VehiclesRepository, useValue: vehicles },
        { provide: VehiclesQueryService, useValue: query },
      ],
    }).compile();

    const svc = module.get(VehiclesUpdateService);
    const res = await svc.update(
      vehicleId,
      { inShop: true, driverId },
      audit
    );

    expect(vehicles.updateOne).toHaveBeenCalledWith(
      { vehicleId },
      {
        $set: expect.objectContaining({
          inShop: true,
          driverId,
        }),
      }
    );
    expect(res.inShop).toBe(true);
  });
});
