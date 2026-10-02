import { Injectable, inject } from '@angular/core';
import { Subject, type Observable } from 'rxjs';
import type { PowerStateChangePayload } from '../../capacitor/power-state.plugin';
import { POWER_STATE_PLUGIN } from './power-state-plugin.token';
import { MqttClientService } from '../features/mqtt/services/mqtt-client.service';
import { TABLET_ENV, type TabletEnv } from './tablet-env.token';

/**
 * Interprets power connected/disconnected as engine proxy; grace period before engine-off.
 */
@Injectable({ providedIn: 'root' })
export class PowerStateMonitorService {
  private readonly mqtt = inject(MqttClientService);
  private readonly env = inject<TabletEnv>(TABLET_ENV);
  private readonly powerPlugin = inject(POWER_STATE_PLUGIN);

  private readonly engineOffSubject = new Subject<void>();
  private readonly engineOnSubject = new Subject<void>();

  readonly engineOff$: Observable<void> = this.engineOffSubject.asObservable();
  readonly engineOn$: Observable<void> = this.engineOnSubject.asObservable();

  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private inEngineOff = false;

  async start(): Promise<void> {
    await this.powerPlugin.addListener(
      'powerStateChange',
      (payload: PowerStateChangePayload) => {
        this.onPowerState(payload.connected);
      }
    );
  }

  private onPowerState(connected: boolean): void {
    if (connected) {
      if (this.graceTimer !== null) {
        clearTimeout(this.graceTimer);
        this.graceTimer = null;
      }
      if (this.inEngineOff) {
        this.inEngineOff = false;
        this.engineOnSubject.next();
        void this.mqtt.publishPowerState({ engineOn: true });
      }
      return;
    }

    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
    }

    const graceMs = this.env.POWER_ENGINE_OFF_GRACE_MS ?? 30_000;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.inEngineOff) {
        return;
      }
      this.inEngineOff = true;
      // eslint-disable-next-line no-console -- tablet structured log (T053)
      console.info(
        JSON.stringify({
          event: 'device.power.engine_off',
          graceMs,
        })
      );
      this.engineOffSubject.next();
      void this.mqtt.publishPowerState({ engineOn: false });
    }, graceMs);
  }
}
