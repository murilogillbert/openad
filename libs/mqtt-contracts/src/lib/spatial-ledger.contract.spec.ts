import {
  spatialLostOpportunityBatchSchema,
  spatialReceiptBatchSchema,
} from './spatial-ledger.contract';

describe('spatial-ledger.contract', () => {
  it('parses receipt batch', () => {
    const batch = {
      schemaVersion: 1 as const,
      kind: 'spatial.receipt' as const,
      ts: new Date().toISOString(),
      deviceId: '550e8400-e29b-41d4-a716-446655440000',
      events: [],
    };
    expect(spatialReceiptBatchSchema.parse(batch).events).toEqual([]);
  });

  it('parses lost-opportunity batch', () => {
    const batch = {
      schemaVersion: 1 as const,
      kind: 'spatial.lost_opportunity' as const,
      ts: new Date().toISOString(),
      deviceId: '550e8400-e29b-41d4-a716-446655440000',
      events: [
        {
          eventId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          deviceId: '550e8400-e29b-41d4-a716-446655440000',
          suppressedMediaId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
          winningMediaId: null,
          reason: 'higher_tier' as const,
          zoneId: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
          ts: new Date().toISOString(),
        },
      ],
    };
    expect(spatialLostOpportunityBatchSchema.parse(batch).events).toHaveLength(1);
  });
});
