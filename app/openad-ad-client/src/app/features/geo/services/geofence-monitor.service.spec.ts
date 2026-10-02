import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SpatialManifestContract } from '@openad/api-contracts';
import { PlaybackEngineService } from '../../playback/services/playback-engine.service';
import { DownloadProgressIdbService } from '../../sync/services/download-progress-idb.service';
import { GeofenceMonitorService } from './geofence-monitor.service';
import { ShadowQueueService } from './shadow-queue.service';
import { SpatialArbitrationEngineService } from './spatial-arbitration-engine.service';
import { SpatialCooldownStoreService } from './spatial-cooldown-store.service';
import { SpatialTelemetryService } from './spatial-telemetry.service';

describe('GeofenceMonitorService', () => {
  let svc: GeofenceMonitorService;
  let idb: { getCachedManifest: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    idb = {
      getCachedManifest: vi.fn(),
    };
    const playback = {
      getSpatialArbitrationSnapshot: vi.fn().mockReturnValue({
        playbackStatus: 'idle',
        currentKind: null,
      }),
    };
    const cooldown = {
      getLastFireMs: vi.fn().mockResolvedValue(null),
      setLastFireMs: vi.fn().mockResolvedValue(undefined),
    };
    const telemetry = {
      publishLostOpportunityEvents: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        GeofenceMonitorService,
        SpatialArbitrationEngineService,
        ShadowQueueService,
        { provide: DownloadProgressIdbService, useValue: idb },
        { provide: PlaybackEngineService, useValue: playback },
        { provide: SpatialCooldownStoreService, useValue: cooldown },
        { provide: SpatialTelemetryService, useValue: telemetry },
      ],
    });
    svc = TestBed.inject(GeofenceMonitorService);
    TestBed.inject(SpatialArbitrationEngineService).resetSequentialCursor();
  });

  it('does not fire dwell before threshold', async () => {
    const spatial: SpatialManifestContract = {
      version: '1',
      entries: [
        {
          zoneId: '550e8400-e29b-41d4-a716-446655440000',
          tier: 'T4',
          priorityScore: 1,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [0, 1],
                [1, 1],
                [1, 0],
                [0, 0],
              ],
            ],
          },
          mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          trigger: { mode: 'dwell', dwellSeconds: 30 },
          rotation: 'sequential',
          arbitration: { pacingFactor: 1, weights: { p: 1, d: 1, h: 1 } },
        },
      ],
    };
    idb.getCachedManifest.mockResolvedValue({
      deviceId: 'd',
      version: 'v',
      media: [],
      spatial,
    });
    const t0 = 1_000_000;
    const r1 = await svc.evaluatePosition(0.5, 0.5, t0);
    expect(r1).toHaveLength(0);
    const r2 = await svc.evaluatePosition(0.5, 0.5, t0 + 5_000);
    expect(r2).toHaveLength(0);
  });

  it('fires entry on boundary cross', async () => {
    const spatial: SpatialManifestContract = {
      version: '1',
      entries: [
        {
          zoneId: '550e8400-e29b-41d4-a716-446655440000',
          tier: 'T4',
          priorityScore: 1,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [0, 1],
                [1, 1],
                [1, 0],
                [0, 0],
              ],
            ],
          },
          mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          trigger: { mode: 'entry' },
          rotation: 'sequential',
          arbitration: { pacingFactor: 1, weights: { p: 1, d: 1, h: 1 } },
          hysteresisExitMeters: 500,
        },
      ],
    };
    idb.getCachedManifest.mockResolvedValue({
      deviceId: 'd',
      version: 'v',
      media: [],
      spatial,
    });
    const out = await svc.evaluatePosition(0.5, 0.5, Date.now());
    expect(out).toHaveLength(1);
    expect(out[0]?.mediaId).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  });
});
