import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { App } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';

export interface DeviceLocationSnapshot {
  latitude: number;
  longitude: number;
  /** km/h when available from the platform */
  speedKmh?: number;
  /** Horizontal accuracy in meters when the platform provides it */
  accuracyM?: number;
  timestamp: string;
}

/**
 * GPS position + speed for manifest constraints and playback filtering.
 */
@Injectable({ providedIn: 'root' })
export class DeviceInfoService {
  private readonly platformId = inject(PLATFORM_ID);
  private watchId: string | null = null;

  readonly location = signal<DeviceLocationSnapshot | null>(null);

  /** Start watching position (browser / native). Safe to call more than once. */
  async start(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (this.watchId != null) {
      return;
    }
    const perm = await Geolocation.requestPermissions();
    if (perm.location !== 'granted') {
      return;
    }
    this.watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 10_000 },
      (pos, err) => {
        if (err || !pos) {
          return;
        }
        const speedMs = pos.coords.speed;
        const acc = pos.coords.accuracy;
        this.location.set({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speedKmh:
            speedMs != null && !Number.isNaN(speedMs)
              ? speedMs * 3.6
              : undefined,
          accuracyM:
            acc != null && !Number.isNaN(acc) && acc >= 0 ? acc : undefined,
          timestamp: new Date(pos.timestamp).toISOString(),
        });
      }
    );
  }

  async stop(): Promise<void> {
    if (this.watchId) {
      await Geolocation.clearWatch({ id: this.watchId });
      this.watchId = null;
    }
  }

  /** Ad-client semantic version when running in Capacitor native / web. */
  async getAppVersionLabel(): Promise<string> {
    if (!isPlatformBrowser(this.platformId)) {
      return '0.0.0';
    }
    try {
      const i = await App.getInfo();
      return i.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}
