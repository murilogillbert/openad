import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PinoLogger } from 'nestjs-pino';
import {
  spatialLedgerBatchSchema,
  type SpatialLedgerBatch,
} from '@openad/mqtt-contracts';
import {
  LostOpportunityEventRecord,
} from './schemas/lost-opportunity-event.schema';
import { SpatialReceiptRecord } from './schemas/spatial-receipt.schema';
import {
  ZoneResidencyIntervalRecord,
} from './schemas/zone-residency-interval.schema';
import { SpatialLedgerIngestService } from './spatial-ledger-ingest.service';

const sampleReceiptBatch: SpatialLedgerBatch = {
  schemaVersion: 1,
  kind: 'spatial.receipt',
  ts: new Date().toISOString(),
  deviceId: '550e8400-e29b-41d4-a716-446655440001',
  events: [
    {
      eventId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      deviceId: '550e8400-e29b-41d4-a716-446655440001',
      mediaId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
      zoneId: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      coordinateStart: { lat: -23.5, lng: -46.6 },
      coordinateEnd: { lat: -23.5, lng: -46.6 },
      accuracyMeters: 12,
      tier: 'T4',
    },
  ],
};

describe('SpatialLedgerIngestService', () => {
  const mockReceipt = { updateOne: jest.fn().mockResolvedValue({}) };
  const mockResidency = { updateOne: jest.fn().mockResolvedValue({}) };
  const mockLost = { updateOne: jest.fn().mockResolvedValue({}) };

  async function compileSvc(): Promise<SpatialLedgerIngestService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SpatialLedgerIngestService,
        { provide: getModelToken(SpatialReceiptRecord.name), useValue: mockReceipt },
        {
          provide: getModelToken(ZoneResidencyIntervalRecord.name),
          useValue: mockResidency,
        },
        {
          provide: getModelToken(LostOpportunityEventRecord.name),
          useValue: mockLost,
        },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();
    return moduleRef.get(SpatialLedgerIngestService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists spatial.receipt events via upsert', async () => {
    const svc = await compileSvc();
    const r = await svc.ingestBatch(sampleReceiptBatch, null);
    expect(r.ok).toBe(true);
    expect(mockReceipt.updateOne).toHaveBeenCalled();
    expect(mockResidency.updateOne).not.toHaveBeenCalled();
  });

  it('returns ok false for invalid payloads', async () => {
    const svc = await compileSvc();
    const r = await svc.ingestBatch({ not: 'valid' }, null);
    expect(r.ok).toBe(false);
    expect(mockReceipt.updateOne).not.toHaveBeenCalled();
  });

  it('accepts MQTT contract sample payloads (Zod)', () => {
    const parsed = spatialLedgerBatchSchema.safeParse(sampleReceiptBatch);
    expect(parsed.success).toBe(true);
  });
});
