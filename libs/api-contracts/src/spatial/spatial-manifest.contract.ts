import { z } from 'zod';

const lngLatSchema = z.object({ lng: z.number(), lat: z.number() });

const circleGeometrySchema = z.object({
  type: z.literal('Circle'),
  center: lngLatSchema,
  radiusMeters: z.number().positive(),
});

const polygonGeometrySchema = z.object({
  type: z.literal('Polygon'),
  /** GeoJSON Polygon: array of rings; each ring is an array of [lng, lat] positions. */
  coordinates: z.array(z.array(z.array(z.number()))),
});

export const spatialGeometrySchema = z.discriminatedUnion('type', [
  circleGeometrySchema,
  polygonGeometrySchema,
]);

export const spatialEntrySchema = z.object({
  zoneId: z.string().uuid(),
  tier: z.enum(['T1', 'T2', 'T3', 'T4']),
  priorityScore: z.number(),
  geometry: spatialGeometrySchema,
  mediaId: z.string().uuid(),
  trigger: z.object({
    mode: z.enum(['entry', 'dwell']),
    dwellSeconds: z.number().positive().optional(),
  }),
  rotation: z.enum(['sequential', 'weighted_random', 'priority_first']),
  arbitration: z.object({
    pacingFactor: z.number(),
    weights: z.object({ p: z.number(), d: z.number(), h: z.number() }),
  }),
  epicenter: lngLatSchema.optional(),
  velocity: z
    .object({
      maxKmhSilence: z.number().optional(),
      minKmhDwell: z.number().optional(),
    })
    .optional(),
  hysteresisExitMeters: z.number().optional(),
  cooldownSeconds: z.number().optional(),
});

export const spatialManifestSchema = z.object({
  version: z.string(),
  entries: z.array(spatialEntrySchema),
});

export type SpatialGeometryContract = z.infer<typeof spatialGeometrySchema>;
export type SpatialEntryContract = z.infer<typeof spatialEntrySchema>;
export type SpatialManifestContract = z.infer<typeof spatialManifestSchema>;
