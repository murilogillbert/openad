import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PinoLogger } from 'nestjs-pino';
import type { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { AssetIntegrityService } from './asset-integrity.service';
import { CreativeAssetsRepository } from './creative-assets.repository';

describe('AssetIntegrityService', () => {
  it('sha256FromBuffer matches node crypto', () => {
    const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
    const repo = {} as CreativeAssetsRepository;
    const storage = {
      readBuffer: jest.fn(),
    } as unknown as AssetStorageService;
    const svc = new AssetIntegrityService(logger, repo, storage);
    const buf = Buffer.from('hello');
    expect(svc.sha256FromBuffer(buf)).toBe(
      createHash('sha256').update(buf).digest('hex')
    );
  });

  it('verifyAssetFile transitions pending → verified when checksum matches', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-'));
    const filePath = path.join(dir, 'f.bin');
    const data = Buffer.from('creative-bytes');
    await fs.writeFile(filePath, data);
    const sum = createHash('sha256').update(data).digest('hex');

    const updates: unknown[] = [];
    const repo = {
      findByAssetId: jest.fn().mockResolvedValue({
        assetId: 'aid',
        campaignId: 'cid',
        storageUrl: filePath,
        checksumSha256: sum,
      }),
      updateOne: jest.fn().mockImplementation((_f, u) => {
        updates.push(u);
        return Promise.resolve({});
      }),
    } as unknown as CreativeAssetsRepository;

    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as PinoLogger;

    const storage = {
      readBuffer: jest.fn(async (url: string) => fs.readFile(url)),
    } as unknown as AssetStorageService;

    const svc = new AssetIntegrityService(logger, repo, storage);
    await svc.verifyAssetFile('aid', {
      correlationId: 'c1',
      operatorUserId: 'u1',
      operatorEmail: 'e',
      operatorRole: 'system',
    });

    expect(repo.updateOne).toHaveBeenCalled();
    expect((updates[0] as { $set: { status: string } }).$set.status).toBe(
      'verified'
    );
  });

  it('verifyAssetFile sets rejected on mismatch', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai2-'));
    const filePath = path.join(dir, 'f.bin');
    await fs.writeFile(filePath, Buffer.from('x'));

    const repo = {
      findByAssetId: jest.fn().mockResolvedValue({
        assetId: 'aid',
        campaignId: 'cid',
        storageUrl: filePath,
        checksumSha256: '00'.repeat(32),
      }),
      updateOne: jest.fn().mockResolvedValue({}),
    } as unknown as CreativeAssetsRepository;

    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as PinoLogger;

    const storage = {
      readBuffer: jest.fn(async (url: string) => fs.readFile(url)),
    } as unknown as AssetStorageService;

    const svc = new AssetIntegrityService(logger, repo, storage);
    await svc.verifyAssetFile('aid', {
      correlationId: 'c1',
      operatorUserId: 'u1',
      operatorEmail: 'e',
      operatorRole: 'system',
    });

    expect(repo.updateOne).toHaveBeenCalledWith(
      { assetId: 'aid' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'rejected' }),
      })
    );
  });
});
