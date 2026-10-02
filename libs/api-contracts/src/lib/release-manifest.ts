/**
 * Wire shapes for MDM APK release manifests (009).
 * @see specs/009-mdm-apk-distribution/contracts/release-manifest.md
 */

export type ReleaseIntegrity = {
  algorithm: 'sha256';
  value: string;
};

export type LatestStableManifestResponse = {
  channel: 'stable';
  latest: {
    versionIdentifier: string;
    downloadUrl: string;
    integrity: ReleaseIntegrity;
    sizeBytes: number;
  };
};

export type DeviceUpdateManifestResponse = {
  deviceId: string;
  current: { versionIdentifier: string };
  eligible: boolean;
  target: null | {
    versionIdentifier: string;
    downloadUrl: string;
    integrity: ReleaseIntegrity;
    sizeBytes: number;
  };
};
