import { ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { FolderService } from './folder.service';
import { FolderNode } from './schemas/folder-node.schema';

describe('FolderService', () => {
  let svc: FolderService;
  const lockedDoc = {
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    name: 'System',
    parentId: null,
    materializedPath: '/Root/Defaults',
    campaignId: null,
    isSystemLocked: true,
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FolderService,
        {
          provide: getModelToken(FolderNode.name),
          useValue: {
            findOne: jest.fn(),
            findById: jest.fn().mockReturnValue({
              exec: async () => lockedDoc,
            }),
            create: jest.fn(),
          },
        },
        { provide: PinoLogger, useValue: { setContext: jest.fn(), info: jest.fn() } },
      ],
    }).compile();
    svc = module.get(FolderService);
  });

  it('patchFolder rejects system locked folders', async () => {
    await expect(
      svc.patchFolder('507f1f77bcf86cd799439011', { name: 'x' }, 'u1')
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
