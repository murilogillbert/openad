import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ReconciliationService } from './reconciliation.service';
import { GeoZonesRepository } from '../../geo-zones/geo-zones.repository';
import { PlayRecord } from '../schemas/play-record.schema';
import { MediaAsset } from '../../media-ingestion/schemas/media-asset.schema';
import type { PlatformConfig } from '@openad/api-contracts';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';
import { platformConfigDefaults } from '../../platform-config/platform-config.service';

describe('ReconciliationService', () => {
  let svc: ReconciliationService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        {
          provide: PlatformConfigRuntimeService,
          useValue: {
            get: () => {
              const d = platformConfigDefaults();
              return {
                ...d,
                analytics: { ...d.analytics, maxVelocityKmh: 200 },
              } satisfies PlatformConfig;
            },
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
