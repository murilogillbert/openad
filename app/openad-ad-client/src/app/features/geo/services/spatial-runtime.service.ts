import { isPlatformBrowser } from '@angular/common';
import { effect, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { DeviceInfoService } from '../../../core/services/device-info.service';
import { GeofenceMonitorService } from './geofence-monitor.service';
import { LocationPipelineService } from './location-pipeline.service';
import { SpatialPlaybackBridgeService } from './spatial-playback-bridge.service';

/**
 * Watches {@link DeviceInfoService} location and drives geofence evaluation → playback bridge (005).
 * Instantiated via {@link APP_INITIALIZER} so the effect runs whenever GPS updates.
 */
@Injectable({ providedIn: 'root' })
export class SpatialRuntimeService {
  private readonly deviceInfo = inject(DeviceInfoService);
  private readonly pipeline = inject(LocationPipelineService);
  private readonly geofence = inject(GeofenceMonitorService);
  private readonly bridge = inject(SpatialPlaybackBridgeService);
  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    void this.deviceInfo.start();
    effect(() => {
      const loc = this.deviceInfo.location();
      if (!loc) {
        return;
      }
      void this.dispatch(loc);
    });
  }

  private async dispatch(loc: {
    longitude: number;
    latitude: number;
    speedKmh?: number;
  }): Promise<void> {
    const nowMs = Date.now();
    const piped = this.pipeline.processRaw(loc.longitude, loc.latitude, nowMs, {
      speedKmh: loc.speedKmh,
    });
    const picks = await this.geofence.evaluatePosition(
      piped.lng,
      piped.lat,
      nowMs
    );
    for (const p of picks) {
      await this.bridge.notifyEligibleMedia(p, loc.speedKmh);
    }
  }
}
