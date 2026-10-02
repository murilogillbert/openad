import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { DevicesRepository } from '../devices/devices.repository';
import { VehiclesRepository } from './vehicles.repository';
import { VehicleBindingAuditService } from './vehicle-binding-audit.service';
import { VehicleBindingService } from './vehicle-binding.service';

const audit: FleetAuditContext = {
  correlationId: 'c1',
  operatorUserId: 'u1',
  operatorEmail: 'op@test',
  operatorRole: 'fleet_admin',
};

describe('VehicleBindingService', () => {
  let service: VehicleBindingService;
  let vehicles: {
    findByVehicleId: jest.Mock;
    updateOne: jest.Mock;
  };
  let devices: { findByDeviceId: jest.Mock; updateOne: jest.Mock };
  let bindingAudit: { append: jest.Mock };

  beforeEach(async () => {
    vehicles = { findByVehicleId: jest.fn(), updateOne: jest.fn() };
    devices = { findByDeviceId: jest.fn(), updateOne: jest.fn() };
    bindingAudit = { append: jest.fn().mockResolvedValue({}) };

    const module = await Test.createTestingModule({
      providers: [
        VehicleBindingService,
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() },
        },
        { provide: VehiclesRepository, useValue: vehicles },
        { provide: DevicesRepository, useValue: devices },
        { provide: VehicleBindingAuditService, useValue: bindingAudit },
      ],
    }).compile();

    service = module.get(VehicleBindingService);
  });

  const vehicleId = randomUUID();
  const deviceId = randomUUID();

  it('pair adds device and writes audit', async () => {
    vehicles.findByVehicleId.mockResolvedValue({
      vehicleId,
      status: 'active',
      pairedDeviceIds: [],
    });
    devices.findByDeviceId.mockResolvedValue({
      deviceId,
      boundVehicleId: null,
    });
    vehicles.updateOne.mockResolvedValue({});
    devices.updateOne.mockResolvedValue({});

    await service.pair(vehicleId, deviceId, audit);

    expect(vehicles.updateOne).toHaveBeenCalledWith(
      { vehicleId },
      { $addToSet: { pairedDeviceIds: deviceId } }
    );
    expect(devices.updateOne).toHaveBeenCalled();
    expect(bindingAudit.append).toHaveBeenCalledWith(
      { action: 'pair', vehicleId, deviceId },
      audit
    );
  });

  it('pair throws when device bound elsewhere', async () => {
    vehicles.findByVehicleId.mockResolvedValue({
      vehicleId,
      status: 'active',
      pairedDeviceIds: [],
    });
    devices.findByDeviceId.mockResolvedValue({
      deviceId,
      boundVehicleId: randomUUID(),
    });

    await expect(service.pair(vehicleId, deviceId, audit)).rejects.toBeInstanceOf(
      ConflictException
    );
    expect(bindingAudit.append).not.toHaveBeenCalled();
  });

  it('unpair pulls device and writes audit', async () => {
    vehicles.findByVehicleId.mockResolvedValue({
      vehicleId,
      pairedDeviceIds: [deviceId],
    });
    devices.findByDeviceId.mockResolvedValue({
      deviceId,
      boundVehicleId: vehicleId,
    });
    vehicles.updateOne.mockResolvedValue({});
    devices.updateOne.mockResolvedValue({});

    await service.unpair(vehicleId, deviceId, audit);

    expect(vehicles.updateOne).toHaveBeenCalledWith(
      { vehicleId },
      { $pull: { pairedDeviceIds: deviceId } }
    );
    expect(bindingAudit.append).toHaveBeenCalledWith(
      { action: 'unpair', vehicleId, deviceId },
      audit
    );
  });

  it('unpair throws when device not paired', async () => {
    vehicles.findByVehicleId.mockResolvedValue({
      vehicleId,
      pairedDeviceIds: [],
    });

    await expect(service.unpair(vehicleId, deviceId, audit)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('pair throws NotFound when vehicle missing', async () => {
    vehicles.findByVehicleId.mockResolvedValue(null);
    await expect(service.pair(vehicleId, deviceId, audit)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
