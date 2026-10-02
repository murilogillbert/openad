import { z } from 'zod';

/** Folder node returned to the management UI (logical VFS). */
export const mediaFolderNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().nullable(),
  materializedPath: z.string().min(1),
  campaignId: z.string().uuid().nullable(),
  isSystemLocked: z.boolean(),
});

export type MediaFolderNode = z.infer<typeof mediaFolderNodeSchema>;

export const uploadSessionInitRequestSchema = z.object({
  filename: z.string().min(1).max(512),
  contentType: z.string().min(1).max(128),
  /** Optional campaign scopes for later placement; enforced on complete. */
  campaignIds: z.array(z.string().uuid()).optional(),
  /** Mongo folder id for catalog placement (defaults to system Global Ads). */
  folderId: z.string().min(1).optional(),
  /** Campaign id for denormalized asset scope when placing in a campaign folder. */
  campaignId: z.string().uuid().optional(),
});

export type UploadSessionInitRequest = z.infer<typeof uploadSessionInitRequestSchema>;

export const uploadSessionInitResponseSchema = z.object({
  sessionId: z.string().uuid(),
  storageKey: z.string().min(1),
  tenantKeyPrefix: z.string().min(1),
  expiresAt: z.string().datetime(),
  maxBytes: z.number().int().positive(),
});

export type UploadSessionInitResponse = z.infer<typeof uploadSessionInitResponseSchema>;

export const uploadSessionCompleteRequestSchema = z.object({
  /** Optional ETag from S3 after PUT for extra verification. */
  etag: z.string().optional(),
});

export type UploadSessionCompleteRequest = z.infer<
  typeof uploadSessionCompleteRequestSchema
>;

export const uploadSessionCompleteResponseSchema = z.object({
  success: z.literal(true),
  storageKey: z.string(),
  verifiedContentLength: z.number().int().nonnegative(),
  status: z.enum(['verified_pending_catalog', 'catalog_registered']),
  mediaId: z.string().uuid().optional(),
  validationStatus: z
    .enum(['pending', 'approved', 'rejected', 'warning'])
    .optional(),
  probeStatus: z.enum(['pending', 'complete', 'failed']).optional(),
  deduplicated: z.boolean().optional(),
  doohRulesetVersion: z.string().optional(),
});

export type UploadSessionCompleteResponse = z.infer<
  typeof uploadSessionCompleteResponseSchema
>;

export const createMediaFolderRequestSchema = z.object({
  parentId: z.string().min(1),
  name: z.string().min(1).max(256),
  campaignId: z.string().uuid().nullable().optional(),
});

export type CreateMediaFolderRequest = z.infer<
  typeof createMediaFolderRequestSchema
>;

export const patchMediaFolderRequestSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  parentId: z.string().min(1).nullable().optional(),
  campaignId: z.string().uuid().nullable().optional(),
});

export type PatchMediaFolderRequest = z.infer<
  typeof patchMediaFolderRequestSchema
>;

export const cloneMediaAssetRequestSchema = z.object({
  targetFolderId: z.string().min(1),
  /** Display name in target folder; defaults to source filename. */
  filename: z.string().min(1).max(512).optional(),
});

export type CloneMediaAssetRequest = z.infer<typeof cloneMediaAssetRequestSchema>;

export const patchMediaAssetRequestSchema = z.object({
  filename: z.string().min(1).max(512).optional(),
  folderId: z.string().min(1).optional(),
});

export type PatchMediaAssetRequest = z.infer<typeof patchMediaAssetRequestSchema>;
