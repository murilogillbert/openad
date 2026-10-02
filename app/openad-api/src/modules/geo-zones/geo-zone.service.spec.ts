import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { GeoZoneService } from './geo-zone.service';
import { GeoZonesRepository } from './geo-zones.repository';

const auditCtx: FleetAuditContext = {
  correlationId: 'test-corr',
  operatorUserId: 'u1',
  operatorEmail: 't@test.local',
  operatorRole: 'fleet_admin',
};

describe('GeoZoneService', () => {
  const ring = [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ];

  it('rejects dwell binding without dwellSeconds', async () => {
    const zones = { create: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        GeoZoneService,
        { provide: GeoZonesRepository, useValue: zones },
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn() },
        },
      ],
    }).compile();
    const svc = mod.get(GeoZoneService);
    await expect(
      svc.create(
        {
          name: 'n',
          description: '',
          city: 'c',
          geometry: { type: 'Polygon', coordinates: ring },
          tags: [],
          bindings: [
            {
              mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
              triggerMode: 'dwell',
              retriggerCooldownSeconds: 10,
              rotationMode: 'sequential',
            },
          ],
        },
        auditCtx,
        null
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates polygon zone with entry binding', async () => {
    const zones = {
      create: jest.fn().mockImplementation((doc) => Promise.resolve(doc)),
    };
    const mod = await Test.createTestingModule({
      providers: [
        GeoZoneService,
        { provide: GeoZonesRepository, useValue: zones },
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn() },
        },
      ],
    }).compile();
    const svc = mod.get(GeoZoneService);
    const out = await svc.create(
      {
        name: 'n',
        description: '',
        city: 'c',
        geometry: { type: 'Polygon', coordinates: ring },
        tags: [],
        tier: 'T2',
        priorityScore: 42,
        bindings: [
          {
            mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            triggerMode: 'entry',
            retriggerCooldownSeconds: 30,
            rotationMode: 'priority_first',
          },
        ],
      },
      auditCtx,
      null
    );
    expect(out.priorityScore).toBe(42);
    expect(out.tier).toBe('T2');
    expect(zones.create).toHaveBeenCalled();
  });
});
