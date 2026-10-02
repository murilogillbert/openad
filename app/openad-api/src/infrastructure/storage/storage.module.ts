import { Module } from '@nestjs/common';
import { AssetStorageService } from './asset-storage.service';

@Module({
  providers: [AssetStorageService],
  exports: [AssetStorageService],
})
export class AssetStorageModule {}
