import { z } from 'zod';

export enum MediaCategorization {
  UNIVERSAL = 'universal',
  CONDITIONAL = 'conditional',
}

export enum VideoCodec {
  H264 = 'h264',
  H265 = 'h265',
}

const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()))),
});

export const timeWindowSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
});

export const speedRangeSchema = z.object({
  minKmh: z.number().min(0),
  maxKmh: z.number().min(0),
});

export const constraintsSchema = z
  .object({
    geofence: geoJsonPolygonSchema.optional(),
    timeWindows: z.array(timeWindowSchema).optional(),
    speedRange: speedRangeSchema.optional(),
    /** When set, play-record analytics can attribute impressions to this campaign. */
    campaignId: z.string().uuid().optional(),
  })
  .strict();

export type Constraints = z.infer<typeof constraintsSchema>;

export const mediaAssetSchema = z.object({
  mediaId: z.string().uuid(),
  hash: z.string().length(64).regex(/^[a-f0-9]+$/),
  filename: z.string().min(1),
  fileSize: z.number().int().positive(),
  bitrate: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  codec: z.nativeEnum(VideoCodec),
  duration: z.number().positive(),
  categorization: z.nativeEnum(MediaCategorization),
  storageUrl: z.string().min(1),
  uploadedBy: z.string().optional(),
  isActive: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type MediaAssetContract = z.infer<typeof mediaAssetSchema>;
