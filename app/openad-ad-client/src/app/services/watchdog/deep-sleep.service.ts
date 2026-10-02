import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { Device } from '@capacitor/device';
import type { HeartbeatPayload } from '@openad/mqtt-contracts';
import { MqttClientService } from '../../features/mqtt/services/mqtt-client.service';
import { PowerStateMonitorService } from '../power-state-monitor.service';

const LOW_BATTERY_PCT = 20;
const GRACE_MS = 30_000;

/**
 * Deep Sleep: low battery + vehicle power loss after grace — pauses media, keeps MQTT (003 FR-015–017).
 */
@Injectable({ providedIn: 'root' })
export class DeepSleepService {
  private readonly power = inject(PowerStateMonitorService);
  private readonly mqtt = inject(MqttClientService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly inDeepSleep = signal(false);

  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.power.engineOff$.subscribe(() => this.onEngineOff());
    this.power.engineOn$.subscribe(() => this.onEngineOn());
  }

  private onEngineOn(): void {
    this.clearTimers();
    if (this.inDeepSleep()) {
      this.inDeepSleep.set(false);
      void this.publishHeartbeat('awake');
    }
  }

  private onEngineOff(): void {
    this.clearTimers();
    this.graceTimer = setTimeout(() => void this.afterEngineOffGrace(), GRACE_MS);
  }

  private clearTimers(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private async afterEngineOffGrace(): Promise<void> {
    const info = await Device.getBatteryInfo().catch(() => null);
    if (!info) {
      return;
    }
    const pct = Math.round((info.batteryLevel ?? 1) * 100);
    if (pct < LOW_BATTERY_PCT) {
      await this.enterDeepSleep();
    }
  }

  private async enterDeepSleep(): Promise<void> {
    if (this.inDeepSleep()) {
      return;
    }
    this.inDeepSleep.set(true);
    void this.publishHeartbeat('sleeping');
  }

  private async publishHeartbeat(mode: 'sleeping' | 'awake'): Promise<void> {
    if (!this.mqtt.isConnected()) {
      return;
    }
    const id = this.mqtt.getActiveDeviceId();
    if (!id) {
      return;
    }
    const payload: HeartbeatPayload = {
      deviceId: id,
      timestamp: new Date().toISOString(),
      location: { lat: 0, lng: 0, hdop: null, locked: false },
      health: {
        batteryPercentage: 0,
        storageUtilizationPercent: 0,
        gpsHdop: null,
      },
      watchdogState: mode === 'sleeping' ? 'deep_sleep' : 'normal',
    };
    await this.mqtt.publishHeartbeat(payload);
  }
}
