import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AbstractRepository } from '../../infrastructure/mongodb/abstract.repository';
import {
  VehicleBindingAuditEvent,
  VehicleBindingAuditDocument,
} from './vehicle-binding-audit.schema';

export interface BindingAuditPageOptions {
  limit: number;
  deviceId?: string;
  /** Cursor from previous page (opaque). */
  cursor?: string | null;
}

@Injectable()
export class VehicleBindingAuditRepository extends AbstractRepository<VehicleBindingAuditDocument> {
  constructor(
    @InjectModel(VehicleBindingAuditEvent.name)
    model: Model<VehicleBindingAuditDocument>
  ) {
    super(model);
  }

  async findPageByVehicleId(
    vehicleId: string,
    opts: BindingAuditPageOptions
  ): Promise<{ rows: VehicleBindingAuditDocument[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const filter: Record<string, unknown> = { vehicleId };
    if (opts.deviceId) {
      filter.deviceId = opts.deviceId;
    }

    let cursorCreatedAt: Date | undefined;
    let cursorEventId: string | undefined;
    if (opts.cursor) {
      const parsed = decodeCursor(opts.cursor);
      if (parsed) {
        cursorCreatedAt = parsed.createdAt;
        cursorEventId = parsed.eventId;
      }
    }

    if (cursorCreatedAt && cursorEventId) {
      filter.$or = [
        { createdAt: { $lt: cursorCreatedAt } },
        {
          $and: [
            { createdAt: cursorCreatedAt },
            { eventId: { $lt: cursorEventId } },
          ],
        },
      ];
    }

    const take = limit + 1;
    const rows = await this.model
      .find(filter)
      .sort({ createdAt: -1, eventId: -1 })
      .limit(take)
      .exec();

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return { rows: slice, hasMore };
  }
}

function decodeCursor(
  raw: string
): { createdAt: Date; eventId: string } | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const o = JSON.parse(json) as { t?: string; e?: string };
    if (!o.t || !o.e) return null;
    const createdAt = new Date(o.t);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, eventId: o.e };
  } catch {
    return null;
  }
}

export function encodeBindingAuditCursor(
  createdAt: Date,
  eventId: string
): string {
  return Buffer.from(
    JSON.stringify({ t: createdAt.toISOString(), e: eventId }),
    'utf8'
  ).toString('base64url');
}
