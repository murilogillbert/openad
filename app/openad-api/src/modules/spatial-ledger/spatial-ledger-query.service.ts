import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SpatialReceiptRecord,
  type SpatialReceiptDocument,
} from './schemas/spatial-receipt.schema';

export interface ReceiptQueryFilters {
  deviceId?: string;
  zoneId?: string;
  /** ISO-8601 bounds on `startedAt` (lexicographic compare works for ISO strings). */
  fromStartedAt?: string;
  toStartedAt?: string;
}

@Injectable()
export class SpatialLedgerQueryService {
  constructor(
    @InjectModel(SpatialReceiptRecord.name)
    private readonly receipts: Model<SpatialReceiptDocument>
  ) {}

  async findReceipts(filters: ReceiptQueryFilters): Promise<unknown[]> {
    const q: Record<string, unknown> = {};
    if (filters.deviceId) {
      q.deviceId = filters.deviceId;
    }
    if (filters.zoneId) {
      q.zoneId = filters.zoneId;
    }
    if (filters.fromStartedAt || filters.toStartedAt) {
      const range: Record<string, string> = {};
      if (filters.fromStartedAt) {
        range.$gte = filters.fromStartedAt;
      }
      if (filters.toStartedAt) {
        range.$lte = filters.toStartedAt;
      }
      q.startedAt = range;
    }
    return this.receipts
      .find(q)
      .sort({ startedAt: -1 })
      .limit(500)
      .lean()
      .exec();
  }
}
