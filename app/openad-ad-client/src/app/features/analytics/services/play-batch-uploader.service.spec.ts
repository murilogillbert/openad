import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlayBatchUploaderService } from './play-batch-uploader.service';
import { ApiClientService } from '../../../services/api-client.service';
import { DeviceSessionService } from '../../../services/device-session.service';
import { PlayRecordBufferService } from './play-record-buffer.service';

describe('PlayBatchUploaderService', () => {
  let postWithAuth: ReturnType<typeof vi.fn>;
  let peekPending: ReturnType<typeof vi.fn>;
  let markUploaded: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(Capacitor, 'isPluginAvailable').mockReturnValue(false);
    postWithAuth = vi.fn().mockResolvedValue({
      batchId: 'b1',
      acceptedCount: 1,
      enqueued: true,
      rejected: [],
    });
    peekPending = vi.fn().mockResolvedValue([]);
    markUploaded = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { onLine: true } as Navigator);
    TestBed.configureTestingModule({
      providers: [
        PlayBatchUploaderService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: ApiClientService,
          useValue: { postWithAuth },
        },
        {
          provide: DeviceSessionService,
          useValue: {
            getStoredDeviceId: vi.fn().mockResolvedValue('device-uuid-1'),
          },
        },
        {
          provide: PlayRecordBufferService,
          useValue: {
            peekPendingNotUploaded: peekPending,
            markUploaded,
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tryFlush skips when no pending rows', async () => {
    const svc = TestBed.inject(PlayBatchUploaderService);
    await svc.tryFlush();
    expect(postWithAuth).not.toHaveBeenCalled();
  });

  it('tryFlush posts batch JSON envelope and marks accepted plays uploaded', async () => {
    peekPending.mockResolvedValue([
      {
        uniqueEventId: 'u1',
        deviceId: 'device-uuid-1',
        vehicleId: 'v1',
        campaignId: 'c1',
        timestampStart: '2026-04-05T12:00:00.000Z',
        timestampEnd: '2026-04-05T12:00:30.000Z',
        latStart: 0,
        lngStart: 0,
        latEnd: 0,
        lngEnd: 0,
        triggerReason: 'Standard_Loop',
        batteryLevel: 90,
        networkType: '5G',
        gpsAccuracyM: 10,
        uploaded: 0,
        createdAt: '2026-04-05T12:00:00.000Z',
      },
    ]);
    const svc = TestBed.inject(PlayBatchUploaderService);
    await svc.tryFlush();
    expect(postWithAuth).toHaveBeenCalledTimes(1);
    const [path, body] = postWithAuth.mock.calls[0] as [string, unknown];
    // Sem `/api/v1`: quem carrega o prefixo e `API_BASE_URL`. Ver `ApiClientService.resolveUrl`.
    expect(path).toContain('/devices/');
    expect(path).not.toContain('/api/v1');
    expect(path).toContain('/analytics/play-batches');
    const envelope = body as {
      schemaVersion: number;
      deviceId: string;
      plays: Array<{ uniqueEventId: string }>;
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.deviceId).toBe('device-uuid-1');
    expect(envelope.plays[0]?.uniqueEventId).toBe('u1');
    expect(markUploaded).toHaveBeenCalledWith(['u1']);
  });

  it('retries on transient failure then succeeds', async () => {
    peekPending.mockResolvedValue([
      {
        uniqueEventId: 'u2',
        deviceId: 'device-uuid-1',
        vehicleId: 'v1',
        campaignId: 'c1',
        timestampStart: '2026-04-05T12:00:00.000Z',
        timestampEnd: '2026-04-05T12:00:30.000Z',
        latStart: 0,
        lngStart: 0,
        latEnd: 0,
        lngEnd: 0,
        triggerReason: 'Standard_Loop',
        batteryLevel: 90,
        networkType: '5G',
        gpsAccuracyM: 10,
        uploaded: 0,
        createdAt: '2026-04-05T12:00:00.000Z',
      },
    ]);
    postWithAuth
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        batchId: 'b2',
        acceptedCount: 1,
        enqueued: true,
        rejected: [],
      });
    const svc = TestBed.inject(PlayBatchUploaderService);
    await svc.tryFlush();
    expect(postWithAuth).toHaveBeenCalledTimes(3);
    expect(markUploaded).toHaveBeenCalledWith(['u2']);
  });
});
