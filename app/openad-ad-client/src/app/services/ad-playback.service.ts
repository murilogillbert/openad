import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { DeviceConfigPayload, SchedulePayload } from '@openad/mqtt-contracts';
import { CommandHandlerService } from './command-handler.service';
import { MediaSyncService } from './media-sync.service';
import { MqttClientService } from '../features/mqtt/services/mqtt-client.service';
import { PowerStateMonitorService } from './power-state-monitor.service';
import { StorageManagerService } from './storage-manager.service';

type ScheduleRule = SchedulePayload['rules'][number];

const DEFAULT_ASSET_ASSUMED_BYTES = 64 * 1024 * 1024;

/**
 * Ad playback orchestration: engine-off pause, MQTT schedule + commands, media sync, impressions.
 */
@Injectable({ providedIn: 'root' })
export class AdPlaybackService {
  private readonly power = inject(PowerStateMonitorService);
  private readonly mqtt = inject(MqttClientService);
  private readonly mediaSync = inject(MediaSyncService);
  private readonly storage = inject(StorageManagerService);
  private readonly commands = inject(CommandHandlerService);
  private readonly destroyRef = inject(DestroyRef);

  /** True when ads should not play (engine-off grace elapsed). */
  readonly playbackPaused = signal(false);

  /** Latest retained schedule from MQTT. */
  readonly currentSchedule = signal<SchedulePayload | null>(null);

  /** Latest device profile from `devices/{id}/config`. */
  readonly deviceConfig = signal<DeviceConfigPayload | null>(null);

  /** Highest-priority rule currently treated as “on air” (geo/time filters not yet applied). */
  readonly activeRule = signal<ScheduleRule | null>(null);

  private segmentStartMs = Date.now();

  constructor() {
    this.power.engineOff$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.playbackPaused.set(true);
      void this.flushActiveImpression();
    });
    this.power.engineOn$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.playbackPaused.set(false);
      this.segmentStartMs = Date.now();
    });

    this.mqtt.deviceConfig$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((c) => this.deviceConfig.set(c));
    this.mqtt.schedule$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      void this.onSchedule(s);
    });
    this.mqtt.serverCommand$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cmd) => {
      void this.commands.dispatch(cmd);
    });
  }

  /** Snapshot for MQTT telemetry (`playback` block). */
  getTelemetryPlayback(): {
    status: 'playing' | 'idle' | 'error';
    currentAssetId: string | null;
    currentCampaignId: string | null;
    errorCode: string | null;
  } {
    if (this.playbackPaused()) {
      return {
        status: 'idle',
        currentAssetId: this.activeRule()?.assetId ?? null,
        currentCampaignId: null,
        errorCode: null,
      };
    }
    const rule = this.activeRule();
    if (!rule) {
      return {
        status: 'idle',
        currentAssetId: null,
        currentCampaignId: null,
        errorCode: null,
      };
    }
    return {
      status: 'playing',
      currentAssetId: rule.assetId,
      currentCampaignId: `rule:${rule.ruleId}`,
      errorCode: null,
    };
  }

  private async onSchedule(schedule: SchedulePayload): Promise<void> {
    if (this.activeRule()) {
      await this.flushActiveImpression();
    }
    this.currentSchedule.set(schedule);
    const sorted = [...schedule.rules].sort((a, b) => b.priority - a.priority);
    this.activeRule.set(sorted[0] ?? null);
    this.segmentStartMs = Date.now();

    await Promise.all(
      schedule.rules.map((rule) =>
        this.mediaSync.downloadAsset({
          assetId: rule.assetId,
          sizeBytes: DEFAULT_ASSET_ASSUMED_BYTES,
          url: rule.assetUrl,
        })
      )
    );
  }

  private async flushActiveImpression(): Promise<void> {
    const rule = this.activeRule();
    if (!rule || !this.mqtt.getActiveDeviceId() || !this.mqtt.isConnected()) {
      return;
    }
    const durationSec = Math.max(
      1,
      Math.floor((Date.now() - this.segmentStartMs) / 1000)
    );
    const eventId =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${rule.assetId}`;
    await this.mqtt.publishImpression({
      eventId,
      ts: new Date().toISOString(),
      campaignId: `rule:${rule.ruleId}`,
      scheduleRuleId: rule.ruleId,
      assetId: rule.assetId,
      durationPlayedSeconds: durationSec,
      location: {
        lat: null,
        lng: null,
        accuracyMeters: null,
        gpsLocked: false,
      },
    });
    this.segmentStartMs = Date.now();
  }

}
