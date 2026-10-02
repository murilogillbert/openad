import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { MediaGcService } from './media-gc.service';

/**
 * T047 — refcount gating lives in {@link MediaIngestionService#deleteVfsAsset};
 * this service only deletes storage when invoked for an orphaned key.
 */
describe('MediaGcService', () => {
  const assets = {
    deleteObjectByRef: jest.fn().mockResolvedValue(undefined),
  };
  const envBefore = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MEDIA_VFS_TENANT_KEY_PREFIX = 'openad';
  });

  afterEach(() => {
    process.env = { ...envBefore };
  });

  it('refuses delete when key is outside tenant prefix', async () => {
    const svc = new MediaGcService(assets as unknown as AssetStorageService);
    await expect(
      svc.deleteObjectIfOrphaned('other-tenant/x')
    ).rejects.toThrow(/outside tenant prefix/);
    expect(assets.deleteObjectByRef).not.toHaveBeenCalled();
  });

  it('deletes when key is under tenant prefix and refcount caller cleared', async () => {
    const svc = new MediaGcService(assets as unknown as AssetStorageService);
    await svc.deleteObjectIfOrphaned('openad/vfs/sid/file.mp4');
    expect(assets.deleteObjectByRef).toHaveBeenCalledWith(
      'r2:openad/vfs/sid/file.mp4'
    );
  });
});
