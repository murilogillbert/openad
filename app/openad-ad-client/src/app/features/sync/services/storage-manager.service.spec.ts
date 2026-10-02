import { TestBed } from '@angular/core/testing';
import { Filesystem } from '@capacitor/filesystem';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageManagerService as CacheIndexService } from '../../../services/storage-manager.service';
import { SyncStorageManagerService } from './storage-manager.service';

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('SyncStorageManagerService (features/sync)', () => {
  let svc: SyncStorageManagerService;
  let cache: { registerDownload: ReturnType<typeof vi.fn>; removeFromCache: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cache = {
      registerDownload: vi.fn(),
      removeFromCache: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        SyncStorageManagerService,
        { provide: CacheIndexService, useValue: cache },
      ],
    });
    svc = TestBed.inject(SyncStorageManagerService);
  });

  it('pruneLowestPriorityFirst deletes lowest priority entries first', async () => {
    await svc.pruneLowestPriorityFirst(
      [
        { mediaId: 'low', priority: 1, fileSize: 10 },
        { mediaId: 'mid', priority: 50, fileSize: 10 },
        { mediaId: 'keep-high', priority: 100, fileSize: 10 },
      ],
      15
    );

    expect(Filesystem.deleteFile).toHaveBeenCalledWith({
      path: 'media/low',
      directory: expect.anything(),
    });
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({
      path: 'media/mid',
      directory: expect.anything(),
    });
    expect(Filesystem.deleteFile).not.toHaveBeenCalledWith({
      path: 'media/keep-high',
      directory: expect.anything(),
    });
    expect(cache.removeFromCache).toHaveBeenCalledWith('low');
    expect(cache.removeFromCache).toHaveBeenCalledWith('mid');
  });
});
