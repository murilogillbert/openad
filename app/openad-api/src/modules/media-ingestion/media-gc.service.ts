import { Injectable } from '@nestjs/common';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';

/**
 * Two-phase garbage collection for VFS objects (defense in depth on delete).
 */
@Injectable()
export class MediaGcService {
  constructor(
    private readonly assets: AssetStorageService
  ) {}

  tenantPrefix(): string {
    return (
      (process.env.MEDIA_VFS_TENANT_KEY_PREFIX ?? '').trim() || 'openad'
    );
  }

  isKeyInTenantNamespace(storageKey: string): boolean {
    const prefix = this.tenantPrefix();
    return storageKey.startsWith(`${prefix}/`);
  }

  async deleteObjectIfOrphaned(storageKey: string): Promise<void> {
    if (!this.isKeyInTenantNamespace(storageKey)) {
      throw new Error(
        `Refusing to delete object outside tenant prefix: ${storageKey}`
      );
    }
    await this.assets.deleteObjectByRef(`r2:${storageKey}`);
  }
}
