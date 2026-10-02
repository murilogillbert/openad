import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';
import { UploadSessionService } from './upload-session.service';
import { UploadSession } from './schemas/upload-session.schema';

describe('UploadSessionService', () => {
  let service: UploadSessionService;
  const uploadModel = {
    create: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
    updateOne: jest.fn().mockReturnValue({ exec: async () => undefined }),
  };
  const assets = {
    headObjectKey: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadSessionService,
        { provide: getModelToken(UploadSession.name), useValue: uploadModel },
        { provide: AssetStorageService, useValue: assets },
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => {
              const map: Record<string, string> = {
                MEDIA_VFS_TENANT_KEY_PREFIX: 'openad',
                MEDIA_UPLOAD_SESSION_TTL_SECONDS: '3600',
                MEDIA_ALLOWED_MIME_TYPES: '',
              };
              return map[k];
            },
          },
        },
        {
          provide: PlatformConfigRuntimeService,
          useValue: {
            get: () => ({
              mediaLimits: { maxVideoBytes: 524_288_000 },
            }),
          },
        },
      ],
    }).compile();

    service = module.get(UploadSessionService);
  });

  it('createSession rejects invalid body', async () => {
    await expect(
      service.createSession({}, 'user-1')
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verifySessionForCatalog forbids wrong user', async () => {
    uploadModel.findOne.mockReturnValue({
      exec: async () => ({
        sessionId: 's1',
        storageKey: 'openad/vfs/s1/x.mp4',
        tenantKeyPrefix: 'openad',
        initiatedBy: 'owner',
        maxBytes: 999999,
        status: 'initiated',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });

    await expect(
      service.verifySessionForCatalog('s1', 'other')
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('verifySessionForCatalog rejects missing object', async () => {
    uploadModel.findOne.mockReturnValue({
      exec: async () => ({
        sessionId: 's1',
        storageKey: 'openad/vfs/s1/x.mp4',
        tenantKeyPrefix: 'openad',
        initiatedBy: 'u1',
        maxBytes: 999999,
        status: 'initiated',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    });
    assets.headObjectKey.mockResolvedValue(null);

    await expect(
      service.verifySessionForCatalog('s1', 'u1')
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
