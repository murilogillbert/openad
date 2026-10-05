import { Injectable, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { take } from 'rxjs';
import { ApiClientService } from './api-client.service';
import { emGigabytes, estimarArmazenamento } from './device-storage';
import { ManifestHealthService } from './manifest-health.service';
import { PairingEventsService } from './pairing-events.service';

function screenDims(): { w: number; h: number } {
  if (typeof globalThis !== 'undefined' && 'screen' in globalThis) {
    const s = (globalThis as unknown as { screen?: { width?: number; height?: number } })
      .screen;
    return { w: s?.width ?? 1920, h: s?.height ?? 1080 };
  }
  return { w: 1920, h: 1080 };
}

export interface CapabilityManifestPayload {
  screenWidthPx: number;
  screenHeightPx: number;
  screenSizeInches: number;
  totalStorageGb: number;
  availableStorageGb: number;
  osVersion: string;
  appVersion: string;
  firmwareVersion?: string;
}

@Injectable({ providedIn: 'root' })
export class CapabilityManifestService {
  private readonly api = inject(ApiClientService);
  private readonly pairing = inject(PairingEventsService);
  private readonly manifestHealth = inject(ManifestHealthService);

  constructor() {
    this.pairing.pairingComplete$
      .pipe(take(1))
      .subscribe((ev) => void this.report(ev.deviceId));
  }

  /** Idempotent single-shot after pairing (also callable from tests). */
  async report(deviceId: string): Promise<void> {
    const manifest = await this.collectManifest();
    const path = `/devices/${encodeURIComponent(deviceId)}/capability-manifest`;
    let attempt = 0;
    const max = 3;
    let delay = 500;
    while (attempt < max) {
      try {
        await this.api.patch(path, manifest);
        await this.manifestHealth.recordSuccessfulFetch();
        return;
      } catch {
        attempt += 1;
        if (attempt >= max) {
          throw new Error('capability manifest upload failed after retries');
        }
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }

  private async collectManifest(): Promise<CapabilityManifestPayload> {
    const info = await Device.getInfo();
    const appInfo = await App.getInfo();
    const { w, h } = screenDims();

    /**
     * Medicao unica, com a invariante `available <= total` garantida antes do envio.
     *
     * A versao anterior tirava `totalStorageGb` do `size` do diretorio (3452 bytes, que o
     * piso transformava em 1) e deixava `availableStorageGb` no padrao 16. A API respondia
     * HTTP 400 `availableStorageGb must not exceed totalStorageGb`, em laco, a cada ciclo —
     * e o aparelho ficava para sempre com `capabilityManifest: null`.
     */
    const { totalStorageGb, availableStorageGb } = emGigabytes(
      await estimarArmazenamento()
    );

    return {
      screenWidthPx: w,
      screenHeightPx: h,
      screenSizeInches: 10,
      totalStorageGb,
      availableStorageGb,
      osVersion: info.osVersion ?? 'unknown',
      appVersion: appInfo.version ?? '0.0.0',
    };
  }
}
