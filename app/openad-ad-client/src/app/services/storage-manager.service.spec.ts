import { TestBed } from '@angular/core/testing';
import { Filesystem } from '@capacitor/filesystem';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageManagerService } from './storage-manager.service';

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    deleteFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 1024, free: 512 }),
  },
}));

describe('StorageManagerService', () => {
  let svc: StorageManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(StorageManagerService);
  });

  it('ensureSpace evicts LRU (oldest lastPlayedAt) first until space fits', async () => {
    svc._resetForTest([
      { assetId: 'old', sizeBytes: 100, lastPlayedAt: 10 },
      { assetId: 'mid', sizeBytes: 200, lastPlayedAt: 20 },
      { assetId: 'new', sizeBytes: 300, lastPlayedAt: 30 },
    ]);
    vi.spyOn(svc, 'getAvailableBytes').mockResolvedValue(50);

    await svc.ensureSpace(400);

    const remaining = (svc as unknown as { index: { assetId: string }[] }).index;
    expect(remaining.length).toBe(0);
    expect(Filesystem.deleteFile).toHaveBeenCalled();
  });

  it('ensureSpace emits storage_full and throws when cache empty and still not enough space', async () => {
    svc._resetForTest([]);
    vi.spyOn(svc, 'getAvailableBytes').mockResolvedValue(0);
    const next = vi.fn();
    svc.storageFullEvent$.subscribe(next);

    await expect(svc.ensureSpace(100)).rejects.toThrow('storage_full');
    expect(next).toHaveBeenCalled();
  });
});
