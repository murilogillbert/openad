import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { VehicleBindingAuditQueryService } from './vehicle-binding-audit-query.service';
import { VehicleBindingAuditRepository } from './vehicle-binding-audit.repository';

describe('VehicleBindingAuditQueryService', () => {
  it('maps rows to API response', async () => {
    const vid = randomUUID();
    const eid = randomUUID();
    const createdAt = new Date('2026-01-10T10:00:00.000Z');
    const repo = {
      findPageByVehicleId: jest.fn().mockResolvedValue({
        hasMore: false,
        rows: [
          {
            eventId: eid,
            action: 'pair' as const,
            vehicleId: vid,
            deviceId: randomUUID(),
            actorUserId: 'u1',
            createdAt,
          },
        ],
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        VehicleBindingAuditQueryService,
        { provide: VehicleBindingAuditRepository, useValue: repo },
      ],
    }).compile();

    const svc = module.get(VehicleBindingAuditQueryService);
    const res = await svc.listForVehicle(vid, { limit: 10 });

    expect(res.items).toHaveLength(1);
    expect(res.items[0].eventId).toBe(eid);
    expect(res.nextCursor).toBeNull();
  });
});
