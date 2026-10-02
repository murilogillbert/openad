import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { DeviceUpdateManifestResponse } from '@openad/api-contracts';
import { OpenAdSilentInstall } from '../../plugins/openad-silent-install';
import { ApiClientService } from './api-client.service';
import { DeviceSessionService } from './device-session.service';
import { DeviceInfoService } from '../core/services/device-info.service';
import { HashVerifierService } from '../features/sync/services/hash-verifier.service';

/**
 * Fetches staged rollout manifest, verifies APK bytes, writes to cache, then runs
 * {@link OpenAdSilentInstall} (Android PackageInstaller session) for silent same-package upgrade.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly api = inject(ApiClientService);
  private readonly session = inject(DeviceSessionService);
  private readonly deviceInfo = inject(DeviceInfoService);
  private readonly hash = inject(HashVerifierService);

  async runUpdateCheckFlow(): Promise<{
    result: 'up_to_date' | 'downloaded' | 'installed' | 'skipped' | 'failed';
    detail?: string;
  }> {
    const deviceId = await this.session.getStoredDeviceId();
    if (!deviceId) {
      return { result: 'failed', detail: 'no_device' };
    }
    const currentVersion = await this.deviceInfo.getAppVersionLabel();

    let manifest: DeviceUpdateManifestResponse;
    try {
      manifest = await this.api.getWithAuth<DeviceUpdateManifestResponse>(
        `/releases/devices/${encodeURIComponent(deviceId)}/update-manifest?currentVersion=${encodeURIComponent(currentVersion)}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.warn('[AppUpdate] manifest fetch failed', { deviceId, detail: msg });
      await this.reportSafe(deviceId, {
        lastCheckResult: 'update_failed',
        lastError: msg,
      });
      return { result: 'failed', detail: msg };
    }

    await this.reportSafe(deviceId, {
      versionIdentifier: currentVersion,
      lastCheckResult: manifest.target
        ? 'update_available'
        : 'up_to_date',
      lastError: null,
    });

    if (!manifest.target) {
      return { result: 'up_to_date' };
    }

    const t = manifest.target;
    try {
      const res = await fetch(t.downloadUrl, { method: 'GET' });
      if (!res.ok) {
        throw new Error(`download_http_${res.status}`);
      }
      const buf = await res.arrayBuffer();
      const ok = await this.hash.verifyHex(buf, t.integrity.value);
      if (!ok) {
        throw new Error('integrity_mismatch');
      }
      const path = `openad-update-${t.versionIdentifier.replace(/[^a-zA-Z0-9._-]+/g, '_')}.apk`;
      await Filesystem.writeFile({
        path,
        data: this.arrayBufferToBase64(buf),
        directory: Directory.Cache,
      });

      if (Capacitor.getPlatform() === 'android') {
        try {
          const { sessionId } = await OpenAdSilentInstall.installApkFromCache({
            filename: path,
          });
          // eslint-disable-next-line no-console
          console.info('[AppUpdate] PackageInstaller session committed', { sessionId, path });
          await this.reportSafe(deviceId, {
            versionIdentifier: t.versionIdentifier,
            lastCheckResult: 'up_to_date',
            lastError: null,
          });
          return { result: 'installed', detail: `session:${sessionId}` };
        } catch (installErr) {
          const msg =
            installErr instanceof Error ? installErr.message : String(installErr);
          // eslint-disable-next-line no-console
          console.warn('[AppUpdate] silent install failed', { deviceId, detail: msg });
          await this.reportSafe(deviceId, {
            lastCheckResult: 'update_failed',
            lastError: msg,
          });
          return { result: 'failed', detail: msg };
        }
      }

      // Browser / iOS: verified artifact only
      await this.reportSafe(deviceId, {
        versionIdentifier: t.versionIdentifier,
        lastCheckResult: 'up_to_date',
        lastError: null,
      });
      return { result: 'downloaded' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.warn('[AppUpdate] download or verify failed', { deviceId, detail: msg });
      await this.reportSafe(deviceId, {
        lastCheckResult: 'update_failed',
        lastError: msg,
      });
      return { result: 'failed', detail: msg };
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }

  private async reportSafe(
    deviceId: string,
    body: {
      versionIdentifier?: string;
      lastCheckResult?: string;
      lastError?: string | null;
    }
  ): Promise<void> {
    try {
      await this.api.putWithAuth(`/releases/devices/${encodeURIComponent(deviceId)}/report`, body);
    } catch {
      /* non-fatal */
    }
  }
}
