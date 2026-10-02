import { Injectable } from '@nestjs/common';

/**
 * Builds absolute or root-relative URLs embedded in manifests and provisioning payloads.
 */
@Injectable()
export class ReleasesUrlService {
  artifactPath(token: string): string {
    return `/api/v1/releases/artifacts/${token}/app.apk`;
  }

  /** Absolute URL when PUBLIC_API_BASE_URL is set; otherwise path only (clients must prepend origin). */
  buildArtifactUrl(artifactAccessToken: string): string {
    const base = (process.env.PUBLIC_API_BASE_URL ?? '').trim();
    const path = this.artifactPath(artifactAccessToken);
    if (!base) {
      return path;
    }
    return `${base.replace(/\/$/, '')}${path}`;
  }

  stableManifestPath(): string {
    return `/api/v1/releases/public/stable-manifest`;
  }

  buildStableManifestUrl(): string {
    const base = (process.env.PUBLIC_API_BASE_URL ?? '').trim();
    const path = this.stableManifestPath();
    if (!base) {
      return path;
    }
    return `${base.replace(/\/$/, '')}${path}`;
  }

  deviceUpdateManifestPath(deviceId: string): string {
    return `/api/v1/releases/devices/${encodeURIComponent(deviceId)}/update-manifest`;
  }
}
