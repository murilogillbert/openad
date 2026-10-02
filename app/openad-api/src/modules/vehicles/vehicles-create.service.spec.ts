import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { DevicesRepository } from '../devices/devices.repository';
import { VehicleBindingService } from './vehicle-binding.service';
import { VehiclesRepository } from './vehicles.repository';
import { VehiclesQueryService } from './vehicles-query.service';
import { VehiclesCreateService } from './vehicles-create.service';

const audit: FleetAuditContext = {
  correlationId: 'c1',
  operatorUserId: 'op-1',
  operatorEmail: 'op@test',
  operatorRole: 'fleet_admin',
};

describe('VehiclesCreateService', () => {
  let service: VehiclesCreateService;
  let vehicles: { create: jest.Mock };
  let query: { findOne: jest.Mock };
  let devices: { findByDeviceId: jest.Mock };
  let binding: { pair: jest.Mock; unpair: jest.Mock };

  beforeEach(async () => {
    vehicles = { create: jest.fn() };
    query = { findOne: jest.fn() };
    devices = { findByDeviceId: jest.fn() };
    binding = { pair: jest.fn(), unpair: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        VehiclesCreateService,
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() },
        },
        { provide: VehiclesRepository, useValue: vehicles },
        { provide: VehiclesQueryService, useValue: query },
        { provide: DevicesRepository, useValue: devices },
        { provide: VehicleBindingService, useValue: binding },
      ],
    }).compile();

    service = module.get(VehiclesCreateService);
  });

  const dto = {
    registrationPlate: 'AB-12345',
    make: 'Test',
    model: 'Van',
    year: 2024,
    commercialTier: 'taxi' as const,
  };

  it('creates vehicle and returns detail', async () => {
    vehicles.create.mockResolvedValue({});
    query.findOne.mockResolvedValue({
      vehicleId: 'vid',
      registrationPlate: 'AB-12345',
      bindingStatus: 'hardware_missing',
      pairedDeviceIds: [],
      commercialTier: 'taxi',
    });

    const res = await service.create(dto, audit, randomUUID());

    expect(vehicles.create).toHaveBeenCalled();
    expect(res.registrationPlate).toBe('AB-12345');
    expect(query.findOne).toHaveBeenCalled();
    expect(binding.pair).not.toHaveBeenCalled();
  });

  it('pairs devices after create', async () => {
    const devId = randomUUID();
    vehicles.create.mockResolvedValue({});
    devices.findByDeviceId.mockResolvedValue({
      deviceId: devId,
      boundVehicleId: null,
    });
    binding.pair.mockResolvedValue({ vehicleId: 'x', deviceId: devId });
    query.findOne.mockResolvedValue({
      vehicleId: 'vid',
      registrationPlate: 'AB-12345',
      bindingStatus: 'fully_operational',
      pairedDeviceIds: [devId],
      commercialTier: 'taxi',
    });

    await service.create({ ...dto, pairedDeviceIds: [devId] }, audit, randomUUID());

    expect(devices.findByDeviceId).toHaveBeenCalledWith(devId);
    expect(binding.pair).toHaveBeenCalled();
    expect(binding.unpair).not.toHaveBeenCalled();
  });

  it('throws ConflictException on duplicate plate (Mongo 11000)', async () => {
    vehicles.create.mockRejectedValue({ code: 11000 });

    await expect(service.create(dto, audit, randomUUID())).rejects.toBeInstanceOf(
      ConflictException
    );
  });
});
