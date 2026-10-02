import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EMPTY } from 'rxjs';
import { PlaybackEngineService } from './playback-engine.service';
import { ConstraintFilterService } from './constraint-filter.service';
import { LoopManagerService } from './loop-manager.service';
import { PriorityQueueService } from './priority-queue.service';
import { DownloadProgressIdbService } from '../../sync/services/download-progress-idb.service';
import { ManifestSyncEventsService } from '../../sync/services/manifest-sync-events.service';
import { MqttClientService } from '../../mqtt/services/mqtt-client.service';
import { DeviceInfoService } from '../../../core/services/device-info.service';
import { DeviceFleetContextService } from '../../../services/device-fleet-context.service';
import { DeviceSessionService } from '../../../services/device-session.service';
import { PlayRecordBufferService } from '../../analytics/services/play-record-buffer.service';

describe('PlaybackEngineService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        PlaybackEngineService,
        ConstraintFilterService,
        LoopManagerService,
        PriorityQueueService,
        {
          provide: DownloadProgressIdbService,
          useValue: {
            getCachedManifest: vi.fn().mockResolvedValue(null),
          },
        },
        {
          provide: ManifestSyncEventsService,
          useValue: { manifestSynced$: EMPTY },
        },
        {
          provide: MqttClientService,
          useValue: {
            priorityCommand$: EMPTY,
            publishPriorityAck: vi.fn(),
          },
        },
        {
          provide: DeviceInfoService,
          useValue: {
            start: vi.fn().mockResolvedValue(undefined),
            location: vi.fn().mockReturnValue(null),
          },
        },
        {
          provide: DeviceSessionService,
          useValue: { getStoredDeviceId: vi.fn().mockResolvedValue(null) },
        },
        {
          provide: DeviceFleetContextService,
          useValue: {
            refreshBoundVehicle: vi.fn().mockResolvedValue(undefined),
            resolveBoundVehicleId: vi.fn().mockResolvedValue(null),
          },
        },
        {
          provide: PlayRecordBufferService,
          useValue: { enqueuePlay: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    });
  });

  it('reloadFromManifest clears queue when no cached manifest', async () => {
    await new Promise((r) => setTimeout(r, 30));
    const engine = TestBed.inject(PlaybackEngineService);
    await engine.reloadFromManifest();
    expect(engine.currentAd()).toBeNull();
  });
});
