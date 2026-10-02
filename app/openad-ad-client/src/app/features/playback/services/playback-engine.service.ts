import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Network } from '@capacitor/network';
import type { PlayRecordPayload } from '@openad/api-contracts';
import type { PriorityCommandPayload } from '@openad/mqtt-contracts';
import { firstValueFrom } from 'rxjs';
import { validate as uuidValidate, v4 as uuidv4 } from 'uuid';
import { DeviceInfoService } from '../../../core/services/device-info.service';
import { DeviceFleetContextService } from '../../../services/device-fleet-context.service';
import { DeviceSessionService } from '../../../services/device-session.service';
import type { ManifestMediaItem } from '../../sync/models/manifest-api.model';
import { DownloadProgressIdbService } from '../../sync/services/download-progress-idb.service';
import { ManifestSyncEventsService } from '../../sync/services/manifest-sync-events.service';
import { MqttClientService } from '../../mqtt/services/mqtt-client.service';
import type { QueuedAd } from '../models/ad-queue.model';
import type { PriorityAd } from '../models/ad-queue.model';
import type { PlaybackStatus } from '../models/playback-state.model';
import { ConstraintFilterService } from './constraint-filter.service';
import { LoopManagerService } from './loop-manager.service';
import { PriorityQueueService } from './priority-queue.service';
import { PlayRecordBufferService } from '../../analytics/services/play-record-buffer.service';

/**
 * Manifest loop + factory fallback + MQTT priority with resume (T103–T105).
 */
@Injectable()
export class PlaybackEngineService {
  private readonly idb = inject(DownloadProgressIdbService);
  private readonly constraints = inject(ConstraintFilterService);
  private readonly loop = inject(LoopManagerService);
  private readonly priorityQ = inject(PriorityQueueService);
  private readonly mqtt = inject(MqttClientService);
  private readonly deviceInfo = inject(DeviceInfoService);
  private readonly manifestEvents = inject(ManifestSyncEventsService);
  private readonly session = inject(DeviceSessionService);
  private readonly fleetContext = inject(DeviceFleetContextService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly playRecordBuffer = inject(PlayRecordBufferService);

  readonly currentAd = signal<QueuedAd | null>(null);
  readonly nextAd = signal<QueuedAd | null>(null);
  readonly currentSrc = signal<string | null>(null);
  readonly nextSrc = signal<string | null>(null);
  readonly playbackStatus = signal<PlaybackStatus>('idle');
  readonly lastError = signal<string | null>(null);

  private filteredManifest: ManifestMediaItem[] = [];
  private factoryUrls: string[] = [];
  private interruptedNormalMediaId: string | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.mqtt.priorityCommand$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((cmd) => {
          void this.onPriorityCommand(cmd);
        });

      this.manifestEvents.manifestSynced$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          void this.reloadFromManifest();
        });

      void this.bootstrap();
    }
  }

  private async bootstrap(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    await this.deviceInfo.start();
    void this.fleetContext.refreshBoundVehicle();
    await this.reloadFromManifest();
    await this.loadFactoryFallback();
    this.currentAd.set(await this.takeNextAd());
    this.nextAd.set(await this.peekNextAd());
    await this.applySrcSignals();
  }

  private async loadFactoryFallback(): Promise<void> {
    try {
      const data = await firstValueFrom(
        this.http.get<{ urls?: string[] }>('/factory-default-ads/manifest.json')
      );
      this.factoryUrls = data.urls ?? [];
    } catch {
      this.factoryUrls = [];
    }
  }

  async reloadFromManifest(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const doc = await this.idb.getCachedManifest();
    const loc = this.deviceInfo.location();
    const snap = this.constraints.snapshotFromLocation(loc);
    this.filteredManifest = doc
      ? this.constraints.filter(doc.media, snap)
      : [];
    this.loop.reset();
    this.currentAd.set(await this.takeNextAd());
    this.nextAd.set(await this.peekNextAd());
    await this.applySrcSignals();
  }

  private async onPriorityCommand(cmd: PriorityCommandPayload): Promise<void> {
    const cur = this.currentAd();
    if (cur?.kind === 'manifest') {
      this.interruptedNormalMediaId = cur.item.mediaId;
    } else if (cur?.kind === 'factory') {
      this.interruptedNormalMediaId = cur.mediaId;
    }

    const entry: PriorityAd = {
      commandId: cmd.commandId,
      mediaId: cmd.mediaId,
      expiresAt: cmd.expiresAt,
    };
    this.priorityQ.unshift(entry);

    const item = await this.resolveManifestItem(cmd.mediaId);
    if (item) {
      this.nextAd.set({
        kind: 'priority',
        item,
        command: entry,
      });
      await this.applySrcSignals();
    } else {
      await this.ack(entry, 'skipped');
    }
  }

  /** Pop priority or commit loop pick — used when advancing to the next clip. */
  private async takeNextAd(): Promise<QueuedAd | null> {
    const p = this.priorityQ.peek();
    if (p) {
      this.priorityQ.shift();
      const item = await this.resolveManifestItem(p.mediaId);
      if (item) {
        return { kind: 'priority', item, command: p };
      }
      return this.takeNextAd();
    }

    const manifestPick = this.loop.selectNext(this.filteredManifest);
    if (manifestPick) {
      return { kind: 'manifest', item: manifestPick };
    }

    if (this.factoryUrls.length > 0) {
      const url = this.factoryUrls[Math.floor(Math.random() * this.factoryUrls.length)]!;
      return { kind: 'factory', url, mediaId: `factory:${url}` };
    }

    return null;
  }

  /** Preview following clip without consuming priority (peek only). */
  private async peekNextAd(): Promise<QueuedAd | null> {
    const p = this.priorityQ.peek();
    if (p) {
      const item = await this.resolveManifestItem(p.mediaId);
      if (item) {
        return { kind: 'priority', item, command: p };
      }
      this.priorityQ.shift();
      return this.peekNextAd();
    }

    const manifestPick = this.loop.selectNext(this.filteredManifest);
    if (manifestPick) {
      return { kind: 'manifest', item: manifestPick };
    }

    if (this.factoryUrls.length > 0) {
      const url = this.factoryUrls[Math.floor(Math.random() * this.factoryUrls.length)]!;
      return { kind: 'factory', url, mediaId: `factory:${url}` };
    }

    return null;
  }

  private async resolveManifestItem(
    mediaId: string
  ): Promise<ManifestMediaItem | undefined> {
    const doc = await this.idb.getCachedManifest();
    return doc?.media.find((m) => m.mediaId === mediaId);
  }

  /**
   * Snapshot for spatial arbitration (loop lock vs Tier-1 interrupt) — 005 US5.
   */
  getSpatialArbitrationSnapshot(): {
    playbackStatus: PlaybackStatus;
    currentKind: QueuedAd['kind'] | null;
  } {
    return {
      playbackStatus: this.playbackStatus(),
      currentKind: this.currentAd()?.kind ?? null,
    };
  }

  /** Priority path for spatial engine — same queue shape as MQTT priority (005). */
  async requestSpatialPlayback(mediaId: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const item = await this.resolveManifestItem(mediaId);
    if (!item) {
      return;
    }
    const entry: PriorityAd = {
      commandId: `spatial:${mediaId}:${Date.now()}`,
      mediaId,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    this.priorityQ.unshift(entry);
    this.nextAd.set(await this.peekNextAd());
    await this.applySrcSignals();
  }

  private async applySrcSignals(): Promise<void> {
    const cur = this.currentAd();
    const nxt = this.nextAd();
    this.currentSrc.set(cur ? await this.resolveSrc(cur) : null);
    this.nextSrc.set(nxt ? await this.resolveSrc(nxt) : null);
    this.playbackStatus.set(cur ? 'playing' : 'idle');
  }

  private async resolveSrc(ad: QueuedAd): Promise<string | null> {
    if (ad.kind === 'factory') {
      return ad.url;
    }
    try {
      const uri = await Filesystem.getUri({
        directory: Directory.Data,
        path: `media/${ad.item.mediaId}`,
      });
      return Capacitor.convertFileSrc(uri.uri);
    } catch {
      return null;
    }
  }

  async advance(): Promise<void> {
    const cur = this.currentAd();
    const nxt = this.nextAd();

    if (cur?.kind === 'manifest') {
      this.loop.commitPlayed(cur.item);
      void this.recordManifestPlayCommitted(cur.item);
    } else if (cur?.kind === 'priority') {
      await this.ack(cur.command, 'played');
      if (this.interruptedNormalMediaId) {
        this.loop.setLastPlayedId(this.interruptedNormalMediaId);
        this.interruptedNormalMediaId = null;
      }
    }

    if (nxt?.kind === 'priority') {
      const head = this.priorityQ.peek();
      if (head?.commandId === nxt.command.commandId) {
        this.priorityQ.shift();
      }
    }

    this.currentAd.set(nxt);
    this.nextAd.set(await this.peekNextAd());
    await this.applySrcSignals();
  }

  async onPlaybackError(): Promise<void> {
    this.lastError.set('playback_error');
    this.playbackStatus.set('error');
    const cur = this.currentAd();
    if (cur?.kind === 'priority') {
      await this.ack(cur.command, 'failed');
    }
    await this.advance();
  }

  /**
   * Buffer a high-fidelity play record when a manifest loop item completes (006 US1).
   * Requires a fleet-bound vehicle and `campaignId` on the manifest item (from media placement).
   */
  private async recordManifestPlayCommitted(item: ManifestMediaItem): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      const deviceId = await this.session.getStoredDeviceId();
      if (!deviceId) {
        return;
      }
      const vehicleId = await this.fleetContext.resolveBoundVehicleId();
      if (!vehicleId) {
        return;
      }
      const campaignId = item.campaignId;
      if (!campaignId || !uuidValidate(campaignId)) {
        return;
      }
      const loc = this.deviceInfo.location();
      const end = new Date();
      const durationSec =
        typeof item.duration === 'number' && item.duration > 0 ? item.duration : 15;
      const start = new Date(end.getTime() - durationSec * 1000);
      const lat = loc?.latitude ?? 0;
      const lng = loc?.longitude ?? 0;
      const gpsAccuracyM = loc?.accuracyM ?? 0;

      const [batteryInfo, netStatus] = await Promise.all([
        Device.getBatteryInfo().catch(() => null),
        Network.getStatus().catch(() => null),
      ]);
      const batteryLevel =
        batteryInfo?.batteryLevel != null
          ? Math.round(
              Math.min(100, Math.max(0, batteryInfo.batteryLevel * 100))
            )
          : 0;
      const networkType = netStatus?.connected
        ? (netStatus.connectionType ?? 'unknown')
        : 'none';

      const play: PlayRecordPayload = {
        uniqueEventId: uuidv4(),
        deviceId,
        vehicleId,
        campaignId,
        mediaId: item.mediaId,
        timestampStart: start.toISOString(),
        timestampEnd: end.toISOString(),
        latStart: lat,
        lngStart: lng,
        latEnd: lat,
        lngEnd: lng,
        triggerReason: 'Standard_Loop',
        batteryLevel,
        networkType,
        gpsAccuracyM,
      };
      await this.playRecordBuffer.enqueuePlay(play);
    } catch {
      /* analytics buffer must not break playback */
    }
  }

  private async ack(
    cmd: PriorityAd,
    status: 'received' | 'played' | 'failed' | 'expired' | 'skipped'
  ): Promise<void> {
    const deviceId = await this.session.getStoredDeviceId();
    if (!deviceId) {
      return;
    }
    await this.mqtt.publishPriorityAck({
      deviceId,
      commandId: cmd.commandId,
      status,
      timestamp: new Date().toISOString(),
    });
  }
}
