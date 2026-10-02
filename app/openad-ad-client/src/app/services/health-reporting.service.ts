import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { Device } from '@capacitor/device';
import type { TelemetryPayload } from '@openad/mqtt-contracts';
import { AdPlaybackService } from './ad-playback.service';
import { PlaybackEngineService } from '../features/playback/services/playback-engine.service';
import { MqttClientService } from '../features/mqtt/services/mqtt-client.service';
import { StorageManagerService } from './storage-manager.service';
import { TabletNativeIntegrationService } from './tablet-native-integration.service';
import { DeviceInfoService } from '../core/services/device-info.service';

const TELEMETRY_INTERVAL_MS = 30_000;

/**
 * Bridges tablet health signals to fleet telemetry (MQTT) and local flags.
 */
@Injectable({ providedIn: 'root' })
export class HealthReportingService {
  private readonly storage = inject(StorageManagerService);
  private readonly mqtt = inject(MqttClientService);
  private readonly playback = inject(AdPlaybackService);
  private readonly engine = inject(PlaybackEngineService);
  private readonly nativeIntegration = inject(TabletNativeIntegrationService);
  private readonly deviceInfo = inject(DeviceInfoService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  private storageFullHooked = false;
  private storageFullFlagged = false;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;

  /** Subscribe once to storage-full and mark low-storage for next telemetry. */
  wireStorageFullFlag(): void {
    if (this.storageFullHooked) {
      return;
    }
    this.storageFullHooked = true;
    this.storage.storageFullEvent$.subscribe(() => {
      this.storageFullFlagged = true;
      console.warn(
        JSON.stringify({
          event: 'device.health.storage_full',
          flagged: true,
        })
      );
    });
    this.startTelemetryLoop();
  }

  private startTelemetryLoop(): void {
    if (!isPlatformBrowser(this.platformId) || this.telemetryTimer !== null) {
      return;
    }
    const tick = (): void => {
      void this.publishTelemetrySnapshot();
    };
    void tick();
    this.telemetryTimer = setInterval(tick, TELEMETRY_INTERVAL_MS);
    this.destroyRef.onDestroy(() => {
      if (this.telemetryTimer !== null) {
        clearInterval(this.telemetryTimer);
        this.telemetryTimer = null;
      }
    });
  }

  private async publishTelemetrySnapshot(): Promise<void> {
    if (!this.mqtt.isConnected()) {
      return;
    }
    try {
      const payload = await this.buildTelemetryPayload();
      await this.mqtt.publishTelemetry(payload);
    } catch {
      /* best-effort */
    }
  }

  private async buildTelemetryPayload(): Promise<TelemetryPayload> {
    const ts = new Date().toISOString();
    const [geo, connectivity, nativeExtras] = await Promise.all([
      this.nativeIntegration.getLocationSnapshot(),
      this.nativeIntegration.getConnectivitySnapshot(),
      this.nativeIntegration.buildNativeExtras(),
    ]);
    const watch = this.deviceInfo.location();
    const battery = await Device.getBatteryInfo().catch(() => ({
      batteryLevel: 0.5,
    }));
    const batteryPercent = Math.round((battery.batteryLevel ?? 0.5) * 100);
    const freeBytes = await this.storage.getAvailableBytes();
    const storageFreeGb = Math.max(0, freeBytes / 1024 ** 3);
    // Motor desligado tem precedencia: o player pode ter clipe carregado, mas nada esta
    // sendo exibido. O resto vem do engine, que sabe o que esta na tela de verdade.
    const playback = this.playback.playbackPaused()
      ? {
          status: 'idle' as const,
          currentAssetId: null,
          currentCampaignId: null,
          errorCode: null,
        }
      : this.engine.getTelemetryPlayback();
    const alertFlags: TelemetryPayload['alertFlags'] = [];
    if (this.storageFullFlagged) {
      alertFlags.push('LOW_STORAGE');
    }

    const payload: TelemetryPayload = {
      ts,
      location: {
        lat: watch?.latitude ?? geo.lat,
        lng: watch?.longitude ?? geo.lng,
        accuracyMeters: geo.accuracyMeters,
        gpsLocked: watch != null ? true : geo.gpsLocked,
      },
      connectivity,
      playback,
      device: {
        batteryPercent,
        storageFreeGb,
        cpuLoadPercent: 0,
        memoryUsedPercent: 0,
      },
      alertFlags,
    };
    if (nativeExtras) {
      payload.nativeExtras = nativeExtras;
    }
    return payload;
  }
}
