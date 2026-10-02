import { z } from 'zod';

const tierEnum = z.enum(['T1', 'T2', 'T3', 'T4']);

export const spatialReceiptEventSchema = z.object({
  eventId: z.string().uuid(),
  deviceId: z.string().uuid(),
  mediaId: z.string().uuid(),
  zoneId: z.string().uuid(),
  startedAt: z.string(),
  endedAt: z.string(),
  coordinateStart: z.object({ lat: z.number(), lng: z.number() }),
  coordinateEnd: z.object({ lat: z.number(), lng: z.number() }),
  accuracyMeters: z.number(),
  tier: tierEnum,
});

export const zoneResidencyEventSchema = z.object({
  intervalId: z.string().uuid(),
  deviceId: z.string().uuid(),
  zoneId: z.string().uuid(),
  enteredAt: z.string(),
  exitedAt: z.string().nullable(),
  playedAds: z.boolean(),
});

export const lostOpportunityEventSchema = z.object({
  eventId: z.string().uuid(),
  deviceId: z.string().uuid(),
  suppressedMediaId: z.string().uuid(),
  winningMediaId: z.string().uuid().nullable(),
  reason: z.enum([
    'higher_tier',
    'cooldown',
    'velocity',
    'pacing',
    'loop_lock',
    'other',
  ]),
  zoneId: z.string().uuid(),
  ts: z.string(),
});

export const spatialReceiptBatchSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('spatial.receipt'),
  ts: z.string(),
  deviceId: z.string().uuid(),
  events: z.array(spatialReceiptEventSchema),
});

export const spatialResidencyBatchSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('spatial.residency'),
  ts: z.string(),
  deviceId: z.string().uuid(),
  events: z.array(zoneResidencyEventSchema),
});

export const spatialLostOpportunityBatchSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('spatial.lost_opportunity'),
  ts: z.string(),
  deviceId: z.string().uuid(),
  events: z.array(lostOpportunityEventSchema),
});

export const spatialLedgerBatchSchema = z.discriminatedUnion('kind', [
  spatialReceiptBatchSchema,
  spatialResidencyBatchSchema,
  spatialLostOpportunityBatchSchema,
]);

export type SpatialLedgerBatch = z.infer<typeof spatialLedgerBatchSchema>;
