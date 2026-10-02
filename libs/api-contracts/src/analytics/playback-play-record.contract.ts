import { z } from 'zod';

export const triggerReasonSchema = z.enum([
  'Geofence_Entry',
  'Standard_Loop',
  'Admin_Force',
]);

export const playRecordSchema = z.object({
  uniqueEventId: z.string().uuid(),
  deviceId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  campaignId: z.string().uuid(),
  mediaId: z.string().uuid().optional(),
  timestampStart: z.string().datetime(),
  timestampEnd: z.string().datetime(),
  latStart: z.number(),
  lngStart: z.number(),
  latEnd: z.number(),
  lngEnd: z.number(),
  triggerReason: triggerReasonSchema,
  batteryLevel: z.number().min(0).max(100),
  networkType: z.string(),
  gpsAccuracyM: z.number().nonnegative(),
  displayLux: z.number().optional(),
});

export type PlayRecordPayload = z.infer<typeof playRecordSchema>;

/** Logical batch after HTTP gzip decode (JSON body). */
export const playBatchSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.string().uuid(),
  deviceId: z.string().uuid(),
  plays: z.array(playRecordSchema).min(1).max(100),
  compressed: z.literal(false).optional(),
});

export type PlayBatchPayload = z.infer<typeof playBatchSchema>;

/**
 * Envelope only — `plays` items validated per-record on the server so partial
 * batch success is possible (see spec edge cases).
 */
export const playBatchEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.string().uuid(),
  deviceId: z.string().uuid(),
  plays: z.array(z.unknown()).min(1).max(100),
  compressed: z.literal(false).optional(),
});

export type PlayBatchEnvelope = z.infer<typeof playBatchEnvelopeSchema>;
