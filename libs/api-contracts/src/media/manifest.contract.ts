import { z } from 'zod';
import { spatialManifestSchema } from '../spatial/spatial-manifest.contract';

export const manifestItemSchema = z.object({
  mediaId: z.string().uuid(),
  priority: z.number().int(),
  hash: z.string().length(64),
  downloadUrl: z.string().url(),
  fileSize: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  campaignId: z.string().uuid().optional(),
});

export const manifestSchema = z.object({
  manifestId: z.string().uuid(),
  deviceId: z.string(),
  version: z.number().int().nonnegative(),
  generatedAt: z.string(),
  items: z.array(manifestItemSchema),
  spatial: spatialManifestSchema.optional(),
});

export type ManifestItemContract = z.infer<typeof manifestItemSchema>;
export type ManifestContract = z.infer<typeof manifestSchema>;
