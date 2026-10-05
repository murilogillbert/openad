import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect } from 'vitest';
import { EMPTY } from 'rxjs';
import { MqttClientService } from './mqtt-client.service';
import { DeviceSessionService } from '../../../services/device-session.service';
import { PairingEventsService } from '../../../services/pairing-events.service';
import { TABLET_ENV } from '../../../services/tablet-env.token';

function montar(env: Record<string, unknown> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      MqttClientService,
      { provide: TABLET_ENV, useValue: env },
      {
        provide: PairingEventsService,
        useValue: { pairingComplete$: EMPTY },
      },
      {
        provide: DeviceSessionService,
        useValue: {
          getMqttFromPairing: () => Promise.resolve(null),
        },
      },
      { provide: PLATFORM_ID, useValue: 'browser' },
    ],
  });
  return TestBed.inject(MqttClientService);
}

describe('MqttClientService (features/mqtt)', () => {
  it('is created with MqttModule providers', () => {
    const svc = montar();
    expect(svc).toBeTruthy();
    expect(svc.isConnected()).toBe(false);
  });

  /**
   * Este teste existe por causa de um travamento real em producao.
   *
   * O caminho nativo chamava `MqttBridge.disconnect()` sem nunca ter conectado, e o plugin
   * fazia `client.isConnected()` sobre referencia nula: `NullPointerException` em thread
   * Java, que **mata o processo** e nao passa por `try/catch` de JavaScript. O tablete
   * fechava sozinho depois do pareamento.
   *
   * Com o transporte unico em `mqtt.js` nao existe mais thread nativa envolvida, e desconectar
   * sem ter conectado tem de ser inofensivo. Em TypeScript o teste nao reproduz o
   * `NullPointerException` — ele fixa a propriedade que o conserto garante.
   */
  it('desconectar sem nunca ter conectado nao lanca', async () => {
    const svc = montar();
    await expect(svc.disconnect()).resolves.toBeUndefined();
    expect(svc.isConnected()).toBe(false);
    expect(svc.getActiveDeviceId()).toBeNull();
  });

  it('sem URL de broker, nao tenta conectar e segue utilizavel', async () => {
    const svc = montar({});
    await svc.attachDevice('c5ba917f-56fd-4c36-94f9-9b0f9045da5a');
    expect(svc.isConnected()).toBe(false);
    // Nao guardou o aparelho: sem broker nao ha sessao, e publicar depois seria silenciosa.
    expect(svc.getActiveDeviceId()).toBeNull();
  });

  it('publicar sem conexao nao lanca', async () => {
    const svc = montar();
    await expect(
      svc.publishTelemetry({
        deviceId: 'x',
        timestamp: new Date().toISOString(),
      } as never)
    ).resolves.toBeUndefined();
  });
});
