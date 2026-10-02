import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PinoLogger } from 'nestjs-pino';
import { SpatialManifestBuilderService } from './spatial-manifest-builder.service';
import { GeoZonesRepository } from '../../geo-zones/geo-zones.repository';
import { PacingSignalService } from '../../analytics/services/pacing-signal.service';
import { MediaAsset } from '../../media-ingestion/schemas/media-asset.schema';

describe('SpatialManifestBuilderService', () => {
  it('maps active zones with bindings to spatial entries', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        zoneId: '550e8400-e29b-41d4-a716-446655440000',
        tier: 'T3',
        priorityScore: 5,
        bufferExitMeters: 10,
        isActive: true,
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
        bindings: [
          {
            mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            triggerMode: 'entry',
            retriggerCooldownSeconds: 30,
            rotationMode: 'sequential',
            arbitrationWeights: { wp: 1, wd: 1, wh: 1 },
            pacingFactor: 1,
          },
        ],
      },
    ]);
    const findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        SpatialManifestBuilderService,
        {
          provide: GeoZonesRepository,
          useValue: { findMany },
        },
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn(), debug: jest.fn() },
        },
        {
          provide: getModelToken(MediaAsset.name),
          useValue: { findOne },
        },
        {
          provide: PacingSignalService,
          useValue: { getPacingDeliveryMultiplier: jest.fn().mockResolvedValue(1) },
        },
      ],
    }).compile();
    const svc = moduleRef.get(SpatialManifestBuilderService);
    const out = await svc.build();
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]?.geometry.type).toBe('Polygon');
    expect(out.entries[0]?.tier).toBe('T3');
    expect(out.entries[0]?.arbitration.pacingFactor).toBe(1);
  });

  it('multiplies pacingFactor by campaign pacing delivery multiplier', async () => {
    const mediaId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const campaignId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const findMany = jest.fn().mockResolvedValue([
      {
        zoneId: '550e8400-e29b-41d4-a716-446655440000',
        tier: 'T3',
        priorityScore: 5,
        bufferExitMeters: 10,
        isActive: true,
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
        bindings: [
          {
            mediaId,
            triggerMode: 'entry',
            retriggerCooldownSeconds: 30,
            rotationMode: 'sequential',
            arbitrationWeights: { wp: 1, wd: 1, wh: 1 },
            pacingFactor: 2,
          },
        ],
      },
    ]);
    const findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          mediaId,
          campaignId,
        }),
      }),
    });
    const getPacingDeliveryMultiplier = jest.fn().mockResolvedValue(0.5);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SpatialManifestBuilderService,
        { provide: GeoZonesRepository, useValue: { findMany } },
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn(), debug: jest.fn() },
        },
        { provide: getModelToken(MediaAsset.name), useValue: { findOne } },
        {
          provide: PacingSignalService,
          useValue: { getPacingDeliveryMultiplier },
        },
      ],
    }).compile();
    const svc = moduleRef.get(SpatialManifestBuilderService);
    const out = await svc.build();
    expect(getPacingDeliveryMultiplier).toHaveBeenCalledWith(campaignId);
    expect(out.entries[0]?.arbitration.pacingFactor).toBe(1);
  });
});
