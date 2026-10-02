import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { PlayRecord } from '../analytics/schemas/play-record.schema';
import { RemoteCommandService } from '../fleet-monitor/remote-command.service';
import { DevicesRepository } from '../devices/devices.repository';
import { FleetDomainEventsService } from './fleet-domain-events.service';
import { VehicleBindingAuditService } from './vehicle-binding-audit.service';
import { VehicleDecommissionService } from './vehicle-decommission.service';
import { VehiclesRepository } from './vehicles.repository';

const audit: FleetAuditContext = {
  correlationId: 'c1',
  operatorUserId: 'u1',
  operatorEmail: 'op@test',
  operatorRole: 'fleet_admin',
};

describe('VehicleDecommissionService', () => {
  let service: VehicleDecommissionService;
  let vehicles: { findByVehicleId: jest.Mock; updateOne: jest.Mock };
  let devices: { updateOne: jest.Mock };
  let playRecords: { distinct: jest.Mock };
  let events: { vehicleDecommissioned$: { next: jest.Mock } };
  let bindingAudit: { append: jest.Mock };
  let remoteCommands: { issue: jest.Mock };

  beforeEach(async () => {
    vehicles = { findByVehicleId: jest.fn(), updateOne: jest.fn() };
    devices = { updateOne: jest.fn().mockResolvedValue({}) };
    playRecords = { distinct: jest.fn().mockResolvedValue([]) };
    events = {
      vehicleDecommissioned$: { next: jest.fn() },
    };
    bindingAudit = { append: jest.fn().mockResolvedValue({}) };
    remoteCommands = { issue: jest.fn().mockResolvedValue({ commandId: 'cmd' }) };

    const module = await Test.createTestingModule({
      providers: [
        VehicleDecommissionService,
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
          },
        },
        { provide: VehiclesRepository, useValue: vehicles },
        { provide: DevicesRepository, useValue: devices },
        { provide: getModelToken(PlayRecord.name), useValue: playRecords },
        { provide: FleetDomainEventsService, useValue: events },
        { provide: VehicleBindingAuditService, useValue: bindingAudit },
        { provide: RemoteCommandService, useValue: remoteCommands },
      ],
    }).compile();

    service = module.get(VehicleDecommissionService);
  });

  const vehicleId = randomUUID();
  const d1 = randomUUID();
  const d2 = randomUUID();

  it('throws when vehicle missing', async () => {
    vehicles.findByVehicleId.mockResolvedValue(null);
    await expect(service.decommission(vehicleId, audit)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(remoteCommands.issue).not.toHaveBeenCalled();
  });

  it('issues CLEAR_CACHE for each paired device, then decommissions vehicle and unbinds devices', async () => {
    vehicles.findByVehicleId.mockResolvedValue({
      vehicleId,
      pairedDeviceIds: [d1, d2],
    });
    vehicles.updateOne.mockResolvedValue({});

    const res = await service.decommission(vehicleId, audit);

    expect(remoteCommands.issue).toHaveBeenCalledTimes(2);
    expect(remoteCommands.issue).toHaveBeenCalledWith(
      d1,
      { type: 'CLEAR_CACHE', payload: null },
      audit.operatorUserId
    );
    expect(remoteCommands.issue).toHaveBeenCalledWith(
      d2,
      { type: 'CLEAR_CACHE', payload: null },
      audit.operatorUserId
    );

    expect(vehicles.updateOne).toHaveBeenCalledWith(
      { vehicleId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'decommissioned',
          pairedDeviceIds: [],
        }),
      })
    );

    expect(devices.updateOne).toHaveBeenCalledTimes(2);
    expect(devices.updateOne).toHaveBeenCalledWith(
      { deviceId: d1, boundVehicleId: vehicleId },
      {
        $set: {
          lifecycleState: 'Retired',
          boundVehicleId: null,
          boundAt: null,
        },
      }
    );
    expect(devices.updateOne).toHaveBeenCalledWith(
      { deviceId: d2, boundVehicleId: vehicleId },
      {
        $set: {
          lifecycleState: 'Retired',
          boundVehicleId: null,
          boundAt: null,
        },
      }
    );

    expect(bindingAudit.append).toHaveBeenCalledWith(
      { action: 'decommission', vehicleId, deviceId: null },
      audit
    );
    expect(events.vehicleDecommissioned$.next).toHaveBeenCalledWith({
      vehicleId,
      affectedCampaignIds: [],
    });
    expect(res.status).toBe('decommissioned');
  });

  it('continues decommission when CLEAR_CACHE fails', async () => {
    vehicles.findByVehicleId.mockResolvedValue({
      vehicleId,
      pairedDeviceIds: [d1],
    });
    remoteCommands.issue.mockRejectedValue(new Error('queue down'));
    vehicles.updateOne.mockResolvedValue({});

    await service.decommission(vehicleId, audit);

    expect(vehicles.updateOne).toHaveBeenCalled();
    expect(devices.updateOne).toHaveBeenCalled();
  });
});
