import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { DeviceSessionService } from '../../../services/device-session.service';
import { PairingEventsService } from '../../../services/pairing-events.service';
import { SyncOrchestratorService } from './sync-orchestrator.service';

/** Intervalo entre sincronizacoes de rotina. */
const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/** Espera antes de tentar de novo depois de falha, para nao marretar um link ruim. */
const RETRY_DELAY_MS = 60 * 1000;

/**
 * Dispara {@link SyncOrchestratorService.syncNow}.
 *
 * O orquestrador existia completo — manifesto, delta por JSON Patch, download com resume,
 * verificacao de SHA-256, gravacao em disco, poda e report de status — mas `syncNow()` nao
 * tinha **nenhum** chamador em todo o `src`. O tablet nunca baixava midia: o cache de
 * manifesto ficava vazio e o player caía no `factory-default-ads` para sempre.
 *
 * Tudo que dispara sincronizacao passa por aqui, e por um unico ponto de serializacao: o
 * orquestrador escreve arquivos e `Preferences`, entao duas execucoes simultaneas
 * (intervalo + comando MQTT + volta de rede) corromperiam o estado local.
 */
@Injectable()
export class SyncSchedulerService {
  private readonly orchestrator = inject(SyncOrchestratorService);
  private readonly session = inject(DeviceSessionService);
  private readonly pairingEvents = inject(PairingEventsService);
  private readonly platformId = inject(PLATFORM_ID);

  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private lastAttemptFailed = false;

  /** Chamado por `APP_INITIALIZER`. Idempotente. */
  start(): void {
    if (!isPlatformBrowser(this.platformId) || this.started) {
      return;
    }
    this.started = true;

    this.pairingEvents.pairingComplete$.subscribe(() => {
      void this.syncNow({ forceFull: true });
    });

    if (Capacitor.isPluginAvailable('Network')) {
      void Network.addListener('networkStatusChange', (status) => {
        // Só reage quando ha o que recuperar: rede voltando nao e motivo para
        // ressincronizar um tablet que ja esta em dia.
        if (status.connected && this.lastAttemptFailed) {
          void this.syncNow();
        }
      });
    }

    this.timer = setInterval(() => {
      void this.syncNow();
    }, SYNC_INTERVAL_MS);

    void this.syncNow();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.started = false;
  }

  /**
   * Sincroniza agora, ou devolve a execucao que ja esta em andamento.
   *
   * Nunca rejeita: sincronizacao e melhor-esforco e os chamadores (intervalo, comando MQTT,
   * evento de rede) nao tem como tratar a falha de forma util. O resultado fica em
   * {@link lastSyncFailed} para quem precisar decidir a partir dele.
   */
  async syncNow(options?: { forceFull?: boolean }): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.run(options).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  get lastSyncFailed(): boolean {
    return this.lastAttemptFailed;
  }

  private async run(options?: { forceFull?: boolean }): Promise<void> {
    const deviceId = await this.session.getStoredDeviceId();
    if (!deviceId) {
      // Nao pareado ainda: `pairingComplete$` dispara a primeira sincronizacao.
      return;
    }

    try {
      await this.orchestrator.syncNow(options);
      this.lastAttemptFailed = false;
      this.log('sync.ok', null);
    } catch (e) {
      this.lastAttemptFailed = true;
      this.log('sync.failed', e instanceof Error ? e.message : String(e));
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, RETRY_DELAY_MS);
  }

  /** Log estruturado do tablet, lido via `adb logcat`. */
  private log(event: string, detail: string | null): void {
    console.info(JSON.stringify({ event, detail }));
  }
}
