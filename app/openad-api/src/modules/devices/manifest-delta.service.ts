import { Injectable } from '@nestjs/common';
import type { ManifestDeltaResponse } from '@openad/api-contracts';
import { computeManifestDelta } from './manifest-delta.util';
import { ManifestVersionsRepository } from './manifest-versions.repository';

@Injectable()
export class ManifestDeltaService {
  constructor(private readonly versions: ManifestVersionsRepository) {}

  async getDelta(sinceVersion: number | undefined): Promise<ManifestDeltaResponse> {
    const latest = await this.versions.findLatest();
    if (!latest) {
      return { version: 0, fullSync: true, added: [], removed: [] };
    }

    let prevAssets = null as typeof latest.assets | null;
    if (
      sinceVersion !== undefined &&
      sinceVersion !== null &&
      sinceVersion > 0 &&
      sinceVersion < latest.manifestVersion
    ) {
      const snap = await this.versions.findByVersion(sinceVersion);
      prevAssets = snap?.assets ?? null;
    }

    return computeManifestDelta(
      sinceVersion,
      prevAssets,
      latest.manifestVersion,
      latest.assets
    );
  }
}
