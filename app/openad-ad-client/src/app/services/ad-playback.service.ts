import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { DeviceConfigPayload, SchedulePayload } from '@openad/mqtt-contracts';
import { CommandHandlerService } from './command-handler.service';
import { MqttClientService } from '../features/mqtt/services/mqtt-client.service';
import { PowerStateMonitorService } from './power-state-monitor.service';

/**
 * Plano de controle do tablet: pausa com motor desligado, config de perfil e despacho de
 * comando remoto.
 *
 * **Nao** cuida mais de midia nem de impressao. Fazia as duas coisas, e as duas estavam
 * quebradas: baixava os assets do schedule por um caminho que descartava os bytes sem
 * gravar arquivo, e publicava impressoes com `campaignId: "rule:{ruleId}"` e localizacao
 * nula, poluindo `impression_events` com linhas que nao correspondem a campanha alguma.
 *
 * Midia agora e do {@link SyncOrchestratorService} via {@link SyncSchedulerService}, e a
 * contabilizacao de veiculacao e do {@link PlaybackEngineService}, que grava `PlayRecord`
 * com campanha real e localizacao, enviados em lote para
 * `POST /devices/:id/analytics/play-batches`.
 */
@Injectable({ providedIn: 'root' })
export class AdPlaybackService {
  private readonly power = inject(PowerStateMonitorService);
  private readonly mqtt = inject(MqttClientService);
  private readonly commands = inject(CommandHandlerService);
  private readonly destroyRef = inject(DestroyRef);

  /** True quando os anuncios nao devem tocar (carencia de motor desligado vencida). */
  readonly playbackPaused = signal(false);

  /** Ultimo schedule retido recebido por MQTT. Informativo. */
  readonly currentSchedule = signal<SchedulePayload | null>(null);

  /** Ultimo perfil de dispositivo de `devices/{id}/config`. */
  readonly deviceConfig = signal<DeviceConfigPayload | null>(null);

  constructor() {
    this.power.engineOff$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.playbackPaused.set(true);
    });
    this.power.engineOn$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.playbackPaused.set(false);
    });

    this.mqtt.deviceConfig$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((c) => this.deviceConfig.set(c));

    this.mqtt.schedule$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      this.currentSchedule.set(s);
    });

    this.mqtt.serverCommand$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cmd) => {
      void this.commands.dispatch(cmd);
    });
  }
}
