import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AssetStorageService } from '../../../infrastructure/storage/asset-storage.service';

@Injectable()
export class ReleasesStorageService {
  constructor(
    private readonly assets: AssetStorageService
  ) {}

  private keyPrefix(): string {
    return (
      (process.env.RELEASE_APK_OBJECT_PREFIX ?? '').trim() || 'releases/apk'
    );
  }

  objectKeyForUpload(): string {
    return `${this.keyPrefix()}/${randomUUID()}.apk`;
  }

  async saveApkBuffer(params: {
    buffer: Buffer;
    key: string;
  }): Promise<string> {
    return this.assets.putObjectAtKey(
      params.key,
      params.buffer,
      'application/vnd.android.package-archive'
    );
  }
}
