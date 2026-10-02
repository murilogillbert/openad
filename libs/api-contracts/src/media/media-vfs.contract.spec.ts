import {
  mediaFolderNodeSchema,
  uploadSessionInitRequestSchema,
  uploadSessionInitResponseSchema,
} from './media-vfs.contract';

describe('media-vfs.contract', () => {
  it('accepts valid folder node', () => {
    const parsed = mediaFolderNodeSchema.safeParse({
      id: '507f1f77bcf86cd799439011',
      name: 'Campaigns',
      parentId: null,
      materializedPath: '/Root/Campaigns',
      campaignId: null,
      isSystemLocked: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects folder node with empty path', () => {
    const parsed = mediaFolderNodeSchema.safeParse({
      id: 'x',
      name: 'x',
      parentId: null,
      materializedPath: '',
      campaignId: null,
      isSystemLocked: false,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts upload init request', () => {
    const parsed = uploadSessionInitRequestSchema.safeParse({
      filename: 'spot.mp4',
      contentType: 'video/mp4',
      campaignIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts upload init response shape', () => {
    const parsed = uploadSessionInitResponseSchema.safeParse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      storageKey: 'openad/vfs/sid/file.mp4',
      tenantKeyPrefix: 'openad',
      expiresAt: new Date().toISOString(),
      maxBytes: 1000,
    });
    expect(parsed.success).toBe(true);
  });
});
