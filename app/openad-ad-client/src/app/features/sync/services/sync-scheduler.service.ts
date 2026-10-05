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
      this.log('sync.failed', descreverFalha(e));
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

/**
 * Transforma o que foi lancado numa frase que serve para diagnostico.
 *
 * `e instanceof Error ? e.message : String(e)` nao basta, e o custo apareceu no aparelho: o
 * `HttpErrorResponse` do Angular **nao** estende `Error`, entao a sincronizacao falhava e o
 * log dizia `"detail":"[object Object]"`. Status, URL e corpo do erro — exatamente o que
 * identifica a causa — ficavam de fora, e o unico caminho restante era reproduzir a falha com
 * depurador no WebView.
 */
function descreverFalha(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  if (e && typeof e === 'object') {
    const o = e as {
      status?: number;
      statusText?: string;
      url?: string;
      message?: string;
      error?: unknown;
    };
    const partes: string[] = [];
    if (typeof o.status === 'number') {
      partes.push(`HTTP ${o.status}${o.statusText ? ` ${o.statusText}` : ''}`);
    }
    if (o.url) {
      partes.push(o.url);
    }
    if (o.message) {
      partes.push(o.message);
    }
    if (o.error !== undefined && o.error !== null) {
      // O corpo do erro e onde o servidor explica o motivo; cortado para nao inundar o log.
      const corpo =
        typeof o.error === 'string' ? o.error : JSON.stringify(o.error);
      partes.push(corpo.slice(0, 300));
    }
    if (partes.length) {
      return partes.join(' | ');
    }
    try {
      return JSON.stringify(e).slice(0, 300);
    } catch {
      return 'objeto nao serializavel';
    }
  }
  return String(e);
}
