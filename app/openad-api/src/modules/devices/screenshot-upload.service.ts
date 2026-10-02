import { Injectable } from '@nestjs/common';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { RemoteCommandsRepository } from '../fleet-monitor/remote-commands.repository';

/**
 * Persists GET_SCREENSHOT uploads to S3-compatible object storage (same bucket as media).
 */
@Injectable()
export class ScreenshotUploadService {
  constructor(
    private readonly storage: AssetStorageService,
    private readonly remoteCommands: RemoteCommandsRepository
  ) {}

  async save(
    deviceId: string,
    commandId: string,
    buffer: Buffer
  ): Promise<{ storageUrl: string }> {
    const key = `screenshots/${deviceId}/${commandId}.png`;
    const storageUrl = await this.storage.putObjectAtKey(
      key,
      buffer,
      'image/png'
    );
    await this.remoteCommands.updateOne(
      { commandId },
      {
        $set: {
          screenshotStorageUrl: storageUrl,
          screenshotStoredAt: new Date(),
        },
      }
    );
    return { storageUrl };
  }
}
