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

/** Elemento que o criativo precisa na tela. */
export type MediaKind = 'image' | 'video';

/** Intervalo antes de trocar de criativo depois de uma falha de decodificacao. */
const RECUO_APOS_FALHA_MS = 1_000;

/** Exibicao de imagem quando o manifesto nao traz `duration` utilizavel. */
const EXIBICAO_PADRAO_S = 10;

const EXTENSAO_DE_IMAGEM = /\.(jpe?g|png|webp|gif|bmp|avif)(\?|#|$)/i;

/**
 * Imagem ou video, a partir do `mimeType` do manifesto.
 *
 * Ausencia de `mimeType` resolve para `video`: e o que o manifesto gravado em cache por
 * servidores anteriores a este campo contem, e era o unico comportamento do player antes.
 */
export function kindOf(ad: QueuedAd): MediaKind {
  if (ad.kind === 'factory') {
    return EXTENSAO_DE_IMAGEM.test(ad.url) ? 'image' : 'video';
  }
  return ad.item.mimeType?.startsWith('image/') ? 'image' : 'video';
}

/** Quanto tempo uma imagem fica na tela antes do proximo item. */
export function duracaoDeExibicaoMs(ad: QueuedAd): number {
  const d = ad.kind === 'factory' ? 0 : ad.item.duration;
  const segundos = typeof d === 'number' && d > 0 ? d : EXIBICAO_PADRAO_S;
  return segundos * 1000;
}

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
  /**
   * Como o item atual deve ser renderizado. Imagem num `<video>` nao decodifica.
   *
   * Todo criativo da plataforma hoje e JPEG/PNG, e o player montava um `<video>` para
   * qualquer item do manifesto: o elemento nunca produzia quadro e a tela ficava num
   * retangulo preto. Este sinal e o que a tela consulta para escolher o elemento.
   */
  readonly currentKind = signal<MediaKind>('video');
  readonly nextKind = signal<MediaKind>('video');
  readonly playbackStatus = signal<PlaybackStatus>('idle');
  readonly lastError = signal<string | null>(null);

  private filteredManifest: ManifestMediaItem[] = [];
  private factoryUrls: string[] = [];
  private interruptedNormalMediaId: string | null = null;
  /**
   * Transicao pendente — exibicao de imagem ou recuo apos falha.
   *
   * Um unico identificador para os dois casos porque so pode haver uma transicao agendada:
   * cada chamada de {@link applySrcSignals} cancela a anterior, o que impede que um
   * `advance()` atrasado de um item ja substituido corte o item que esta na tela.
   */
  private transicaoPendente: ReturnType<typeof setTimeout> | null = null;
  /**
   * Comando prioritario que ja recebeu `failed` e nao deve receber `played` no avanco.
   *
   * `onPlaybackError` reconhece a falha e **depois** chama o avanco, que reconhece o item
   * atual como tocado — o servidor recebia `failed` e `played` para o mesmo `commandId` e o
   * ultimo a chegar ganhava, marcando como exibido um anuncio que nao apareceu na tela.
   */
  private prioridadeJaReconhecida: string | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.cancelarTransicao();
    });

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
   * Bloco `playback` da telemetria MQTT, a partir do que esta de fato na tela.
   *
   * Antes a telemetria era montada em `AdPlaybackService` a partir da regra de maior
   * prioridade do schedule retido no MQTT, com `currentCampaignId: "rule:{ruleId}"` — um
   * identificador sintetico que nao corresponde a campanha nenhuma. O mapa de frota
   * mostrava o que o servidor havia mandado tocar, nao o que estava tocando.
   */
  getTelemetryPlayback(): {
    status: PlaybackStatus;
    currentAssetId: string | null;
    currentCampaignId: string | null;
    errorCode: string | null;
  } {
    const cur = this.currentAd();
    if (!cur) {
      return {
        status: 'idle',
        currentAssetId: null,
        currentCampaignId: null,
        errorCode: this.lastError(),
      };
    }
    return {
      status: this.playbackStatus(),
      currentAssetId:
        cur.kind === 'factory' ? cur.mediaId : cur.item.mediaId,
      currentCampaignId:
        cur.kind === 'factory' ? null : (cur.item.campaignId ?? null),
      errorCode: this.lastError(),
    };
  }

  /** Ha anuncio tocando agora. Usado pelo reinicio diario para nao cortar veiculacao. */
  adLoopActive(): boolean {
    return this.currentAd() !== null && this.playbackStatus() === 'playing';
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
    this.cancelarTransicao();

    const cur = this.currentAd();
    const nxt = this.nextAd();
    this.currentSrc.set(cur ? await this.resolveSrc(cur) : null);
    this.nextSrc.set(nxt ? await this.resolveSrc(nxt) : null);
    this.currentKind.set(cur ? kindOf(cur) : 'video');
    this.nextKind.set(nxt ? kindOf(nxt) : 'video');
    this.playbackStatus.set(cur ? 'playing' : 'idle');

    /**
     * Imagem nao tem fim proprio: `<img>` nao emite `ended`, entao sem este temporizador o
     * primeiro criativo ficaria na tela para sempre e o laco nunca giraria — nem haveria
     * `play_record`, porque o registro e gravado em {@link advance}.
     */
    if (cur && this.currentKind() === 'image') {
      this.agendarTransicao(duracaoDeExibicaoMs(cur));
    }
  }

  private agendarTransicao(ms: number): void {
    this.cancelarTransicao();
    this.transicaoPendente = setTimeout(() => {
      this.transicaoPendente = null;
      void this.advance();
    }, ms);
  }

  private cancelarTransicao(): void {
    if (this.transicaoPendente !== null) {
      clearTimeout(this.transicaoPendente);
      this.transicaoPendente = null;
    }
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
      if (this.prioridadeJaReconhecida !== cur.command.commandId) {
        await this.ack(cur.command, 'played');
      }
      this.prioridadeJaReconhecida = null;
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

  /**
   * Falha de decodificacao do item atual: registra, reconhece e passa para o proximo.
   *
   * O avanco e **agendado**, nao imediato. Com todo item do manifesto quebrado — o que
   * aconteceu de fato quando imagens iam para um `<video>` — o caminho `erro -> advance ->
   * erro` girava sem pausa, consumindo CPU e bateria do tablete em laco fechado. Um
   * segundo de intervalo nao desiste do criativo (a proxima sincronizacao pode reparar um
   * download parcial) e tira o laco do caminho quente.
   */
  async onPlaybackError(): Promise<void> {
    this.lastError.set('playback_error');
    this.playbackStatus.set('error');
    const cur = this.currentAd();
    if (cur?.kind === 'priority') {
      this.prioridadeJaReconhecida = cur.command.commandId;
      await this.ack(cur.command, 'failed');
    }
    this.agendarTransicao(RECUO_APOS_FALHA_MS);
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
