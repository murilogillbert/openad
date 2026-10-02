import { PinoLogger } from 'nestjs-pino';
import { MediaIngestionService } from './media-ingestion.service';
import { VideoValidatorService } from './validators/video-validator.service';
import { HashGeneratorService } from './validators/hash-generator.service';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { DoohRulesService } from './dooh-rules.service';
import { FolderService } from './folder.service';
import { UploadSessionService } from './upload-session.service';
import { MediaGcService } from './media-gc.service';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';

describe('MediaIngestionService', () => {
  const metricsStub = {
    mediaVfsOperationSeconds: {
      startTimer: () => () => undefined,
    },
    mediaVfsMutationsTotal: { inc: jest.fn() },
  } as unknown as MetricsService;

  it('listFolderAssets queries by folderId', async () => {
    const findChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const mediaModel = {
      find: jest.fn().mockReturnValue(findChain),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
    };
    const svc = new MediaIngestionService(
      mediaModel as never,
      {} as VideoValidatorService,
      {} as HashGeneratorService,
      {} as AssetStorageService,
      { dedupEnabled: () => false, getRulesetVersion: () => 't' } as DoohRulesService,
      {} as FolderService,
      {} as UploadSessionService,
      { deleteObjectIfOrphaned: jest.fn() } as unknown as MediaGcService,
      metricsStub,
      { setContext: jest.fn(), info: jest.fn() } as unknown as PinoLogger
    );

    await svc.listFolderAssets({ folderId: 'fid', page: 1, limit: 10 });

    expect(mediaModel.find).toHaveBeenCalledWith({
      folderId: 'fid',
      isActive: true,
    });
  });

  it('deleteVfsAsset does not call GC when another active ref exists', async () => {
    const deleteObjectIfOrphaned = jest.fn();
    const mediaModel = {
      findOne: jest.fn().mockReturnValue({
        exec: async () => ({
          mediaId: 'm1',
          isActive: true,
          storageKey: 'openad/shared/key',
        }),
      }),
      updateOne: jest.fn().mockReturnValue({ exec: async () => ({}) }),
      countDocuments: jest.fn().mockReturnValue({ exec: async () => 1 }),
    };
    const svc = new MediaIngestionService(
      mediaModel as never,
      {} as VideoValidatorService,
      {} as HashGeneratorService,
      {} as AssetStorageService,
      { dedupEnabled: () => false, getRulesetVersion: () => 't' } as DoohRulesService,
      {} as FolderService,
      {} as UploadSessionService,
      { deleteObjectIfOrphaned } as unknown as MediaGcService,
      metricsStub,
      { setContext: jest.fn(), info: jest.fn() } as unknown as PinoLogger
    );
    await svc.deleteVfsAsset('m1');
    expect(deleteObjectIfOrphaned).not.toHaveBeenCalled();
  });

  it('deleteVfsAsset calls GC when last ref', async () => {
    const deleteObjectIfOrphaned = jest.fn().mockResolvedValue(undefined);
    const mediaModel = {
      findOne: jest.fn().mockReturnValue({
        exec: async () => ({
          mediaId: 'm1',
          isActive: true,
          storageKey: 'openad/shared/key',
        }),
      }),
      updateOne: jest.fn().mockReturnValue({ exec: async () => ({}) }),
      countDocuments: jest.fn().mockReturnValue({ exec: async () => 0 }),
    };
    const svc = new MediaIngestionService(
      mediaModel as never,
      {} as VideoValidatorService,
      {} as HashGeneratorService,
      {} as AssetStorageService,
      { dedupEnabled: () => false, getRulesetVersion: () => 't' } as DoohRulesService,
      {} as FolderService,
      {} as UploadSessionService,
      { deleteObjectIfOrphaned } as unknown as MediaGcService,
      metricsStub,
      { setContext: jest.fn(), info: jest.fn() } as unknown as PinoLogger
    );
    await svc.deleteVfsAsset('m1');
    expect(deleteObjectIfOrphaned).toHaveBeenCalledWith('openad/shared/key');
  });
});
