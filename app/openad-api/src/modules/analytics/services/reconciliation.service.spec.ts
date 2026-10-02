import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ReconciliationService } from './reconciliation.service';
import { GeoZonesRepository } from '../../geo-zones/geo-zones.repository';
import { PlayRecord } from '../schemas/play-record.schema';
import { MediaAsset } from '../../media-ingestion/schemas/media-asset.schema';
import type { PlatformConfig } from '@openad/api-contracts';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';

describe('ReconciliationService', () => {
  let svc: ReconciliationService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        {
          provide: PlatformConfigRuntimeService,
          useValue: {
            get: () =>
              ({
                dashboard: { mediaStorageQuotaBytes: null },
                mediaLimits: {
                  maxVideoBytes: 1,
                  maxDurationSeconds: 1,
                  maxWidth: 1,
                  maxHeight: 1,
                },
                fleetHealth: {
                  minBatteryPercent: 10,
                  maxStoragePercent: 95,
                  gpsHdopMax: 5,
                  heartbeatFlaggedThresholdMs: 180_000,
                },
                analytics: {
                  enabled: true,
                  maxVelocityKmh: 200,
                  playBatchMaxBytes: 5_242_880,
                  reconFullPlayMinRatio: 0.9,
                  reconMinDurationSec: 3,
                  fraudBlackoutMaxLux: 5,
                  fraudHeartbeatIntervalSec: 30,
                  fraudHeartbeatMinRatio: 0.25,
                },
              }) satisfies PlatformConfig,
          },
        },
        {
          provide: getModelToken(PlayRecord.name),
          useValue: {
            findOne: jest.fn(),
            updateOne: jest.fn(),
          },
        },
        {
          provide: getModelToken(MediaAsset.name),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: GeoZonesRepository,
          useValue: {
            findZonesWithMediaBinding: jest.fn(),
          },
        },
      ],
    }).compile();

    svc = moduleRef.get(ReconciliationService);
  });

  it('classifyPlay: Standard_Loop full duration vs expected media length', () => {
    expect(
      svc.classifyPlay({
        observedDurationSec: 30,
        expectedDurationSec: 30,
        triggerReason: 'Standard_Loop',
        geofenceOk: true,
        mediaId: 'm1',
      })
    ).toEqual({ status: 'billable', billable: true });

    expect(
      svc.classifyPlay({
        observedDurationSec: 27,
        expectedDurationSec: 30,
        triggerReason: 'Standard_Loop',
        geofenceOk: true,
        mediaId: 'm1',
      })
    ).toEqual({ status: 'billable', billable: true });

    expect(
      svc.classifyPlay({
        observedDurationSec: 26,
        expectedDurationSec: 30,
        triggerReason: 'Standard_Loop',
        geofenceOk: true,
        mediaId: 'm1',
      })
    ).toEqual({ status: 'partial', billable: false });
  });

  it('classifyPlay: Geofence_Entry requires geofenceOk', () => {
    expect(
      svc.classifyPlay({
        observedDurationSec: 20,
        expectedDurationSec: 20,
        triggerReason: 'Geofence_Entry',
        geofenceOk: false,
        mediaId: 'm1',
      })
    ).toEqual({ status: 'geofence_failed', billable: false });

    expect(
      svc.classifyPlay({
        observedDurationSec: 20,
        expectedDurationSec: 20,
        triggerReason: 'Geofence_Entry',
        geofenceOk: true,
        mediaId: 'm1',
      })
    ).toEqual({ status: 'billable', billable: true });
  });

  it('classifyPlay: Geofence_Entry without mediaId fails', () => {
    expect(
      svc.classifyPlay({
        observedDurationSec: 20,
        expectedDurationSec: 20,
        triggerReason: 'Geofence_Entry',
        geofenceOk: true,
        mediaId: null,
      })
    ).toEqual({ status: 'geofence_failed', billable: false });
  });
});
