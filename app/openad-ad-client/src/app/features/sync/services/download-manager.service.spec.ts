import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResumableDownloadService } from '../../../services/sync/resumable-download.service';
import { DownloadProgressIdbService } from './download-progress-idb.service';
import { DownloadManagerService } from './download-manager.service';
import { HashVerifierService } from './hash-verifier.service';

describe('DownloadManagerService', () => {
  let svc: DownloadManagerService;
  let resumable: { downloadToBuffer: ReturnType<typeof vi.fn> };
  let idb: {
    getDownloadOffset: ReturnType<typeof vi.fn>;
    setDownloadOffset: ReturnType<typeof vi.fn>;
    clearDownloadOffset: ReturnType<typeof vi.fn>;
  };
  let hashes: { verifyHex: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    resumable = { downloadToBuffer: vi.fn() };
    idb = {
      getDownloadOffset: vi.fn().mockResolvedValue(0),
      setDownloadOffset: vi.fn().mockResolvedValue(undefined),
      clearDownloadOffset: vi.fn().mockResolvedValue(undefined),
    };
    hashes = { verifyHex: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        DownloadManagerService,
        { provide: ResumableDownloadService, useValue: resumable },
        { provide: DownloadProgressIdbService, useValue: idb },
        { provide: HashVerifierService, useValue: hashes },
      ],
    });
    svc = TestBed.inject(DownloadManagerService);
  });

  it('returns buffer when download and hash verify succeed', async () => {
    const enc = new TextEncoder();
    const buf = enc.encode('ok').buffer;
    resumable.downloadToBuffer.mockResolvedValue(buf);
    hashes.verifyHex.mockResolvedValue(true);

    const out = await svc.downloadVerifiedMedia({
      url: 'https://example.com/f',
      mediaId: 'm1',
      expectedHash: 'abc',
      expectedSize: 2,
      maxAttempts: 2,
      baseDelayMs: 1,
    });

    expect(out.byteLength).toBe(2);
    expect(idb.clearDownloadOffset).toHaveBeenCalledWith('m1');
  });

  it('retries with backoff after failure then succeeds', async () => {
    const enc = new TextEncoder();
    const buf = enc.encode('x').buffer;
    resumable.downloadToBuffer
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(buf);
    hashes.verifyHex.mockResolvedValue(true);

    const out = await svc.downloadVerifiedMedia({
      url: 'https://example.com/f',
      mediaId: 'm2',
      expectedHash: 'h',
      expectedSize: 1,
      maxAttempts: 3,
      baseDelayMs: 1,
    });

    expect(resumable.downloadToBuffer).toHaveBeenCalledTimes(2);
    expect(out.byteLength).toBe(1);
  });
});
