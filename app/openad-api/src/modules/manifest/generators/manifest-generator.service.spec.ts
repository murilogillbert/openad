import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { ManifestGeneratorService } from './manifest-generator.service';
import { SpatialManifestBuilderService } from './spatial-manifest-builder.service';
import { AssetStorageService } from '../../../infrastructure/storage/asset-storage.service';
import { MediaAsset } from '../../media-ingestion/schemas/media-asset.schema';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';

const spatialManifestStub = {
  build: jest.fn().mockResolvedValue({ version: '2026-01-01T00:00:00.000Z', entries: [] }),
};

const metricsStub = {
  spatialManifestBuildSeconds: { observe: jest.fn() },
} as unknown as MetricsService;

describe('ManifestGeneratorService', () => {
  it('maps active media to manifest items with presigned URLs', async () => {
    const row = {
      mediaId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      hash: 'a'.repeat(64),
      filename: 'x.mp4',
      fileSize: 100,
      bitrate: 1000,
      width: 320,
      height: 240,
      codec: 'h264' as const,
      duration: 60,
      categorization: 'universal' as const,
      storageUrl: 'memory:k1',
      isActive: true,
    };
    const model = {
      find: jest.fn().mockReturnValue({
        sort: () => ({
          lean: () => ({
            exec: async () => [row],
          }),
        }),
      }),
    };
    const s3 = {
      getPresignedGetUrl: jest.fn().mockResolvedValue('https://signed.example/x'),
    };
    const logger = {
      setContext: jest.fn(),
      debug: jest.fn(),
    } as unknown as PinoLogger;

    const mod = await Test.createTestingModule({
      providers: [
        ManifestGeneratorService,
        { provide: getModelToken(MediaAsset.name), useValue: model },
        { provide: AssetStorageService, useValue: s3 },
        {
          provide: SpatialManifestBuilderService,
          useValue: spatialManifestStub,
        },
        { provide: MetricsService, useValue: metricsStub },
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile();

    const svc = mod.get(ManifestGeneratorService);
    const r = await svc.build('a1b2c3d4-e5f6-7890-abcd-ef1234567890', {});
    expect(r.media).toHaveLength(1);
    expect(r.spatial.entries).toEqual([]);
    expect(r.media[0]?.downloadUrl).toContain('https://');
    expect(s3.getPresignedGetUrl).toHaveBeenCalledWith('memory:k1', 3600);
  });

  it('includes campaignId on manifest items when present on the media row', async () => {
    const campaignId = 'c0ffee00-0000-4000-8000-00000000beef';
    const row = {
      mediaId: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890',
      hash: 'b'.repeat(64),
      filename: 'c.mp4',
      fileSize: 100,
      bitrate: 1000,
      width: 320,
      height: 240,
      codec: 'h264' as const,
      duration: 60,
      categorization: 'universal' as const,
      storageUrl: 'memory:k2',
      isActive: true,
      campaignId,
    };
    const model = {
      find: jest.fn().mockReturnValue({
        sort: () => ({
          lean: () => ({
            exec: async () => [row],
          }),
        }),
      }),
    };
    const s3 = {
      getPresignedGetUrl: jest.fn().mockResolvedValue('https://signed.example/c'),
    };
    const logger = {
      setContext: jest.fn(),
      debug: jest.fn(),
    } as unknown as PinoLogger;

    const mod = await Test.createTestingModule({
      providers: [
        ManifestGeneratorService,
        { provide: getModelToken(MediaAsset.name), useValue: model },
        { provide: AssetStorageService, useValue: s3 },
        {
          provide: SpatialManifestBuilderService,
          useValue: spatialManifestStub,
        },
        { provide: MetricsService, useValue: metricsStub },
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile();

    const svc = mod.get(ManifestGeneratorService);
    const r = await svc.build('a1b2c3d4-e5f6-7890-abcd-ef1234567890', {});
    expect(r.media[0]?.campaignId).toBe(campaignId);
  });
});
