import { Injectable } from '@nestjs/common';
import type { VehicleBindingAuditListResponse } from '@openad/api-contracts';
import { VehicleBindingAuditRepository } from './vehicle-binding-audit.repository';
import { encodeBindingAuditCursor } from './vehicle-binding-audit.repository';

@Injectable()
export class VehicleBindingAuditQueryService {
  constructor(private readonly audit: VehicleBindingAuditRepository) {}

  async listForVehicle(
    vehicleId: string,
    query: { limit?: number; cursor?: string; deviceId?: string }
  ): Promise<VehicleBindingAuditListResponse> {
    const limit = query.limit ?? 50;
    const { rows, hasMore } = await this.audit.findPageByVehicleId(vehicleId, {
      limit,
      cursor: query.cursor ?? null,
      deviceId: query.deviceId,
    });

    const items = rows.map((r) => {
      const created = r.createdAt ?? new Date(0);
      return {
        eventId: r.eventId,
        action: r.action,
        vehicleId: r.vehicleId,
        deviceId: r.deviceId,
        actorUserId: r.actorUserId,
        createdAt: created.toISOString(),
      };
    });

    const last = rows[rows.length - 1];
    const lastCreated = last?.createdAt;
    const nextCursor =
      hasMore && lastCreated
        ? encodeBindingAuditCursor(lastCreated, last.eventId)
        : null;

    return { items, nextCursor };
  }
}
