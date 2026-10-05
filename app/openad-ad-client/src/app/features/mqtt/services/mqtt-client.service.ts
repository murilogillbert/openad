import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';
import type {
  CommandAckPayload,
  DeviceConfigPayload,
  HeartbeatPayload,
  ImpressionPayload,
  PowerStatePayload,
  PriorityAckPayload,
  SchedulePayload,
  ServerCommandPayload,
  SpatialLedgerBatch,
  TelemetryPayload,
} from '@openad/mqtt-contracts';
import {
  priorityCommandSchema,
  schedulePayloadSchema,
  serverCommandPayloadSchema,
} from '@openad/mqtt-contracts';
import type { MqttClient } from 'mqtt';
import {
  Observable,
  ReplaySubject,
  Subject,
  type Subscription,
} from 'rxjs';
import { DeviceSessionService } from '../../../services/device-session.service';
import { normalizarBrokerParaWebSocket } from '../../../services/mqtt-broker-config';
import { OpenAdMqttTopics } from '../../../services/mqtt-topics';
import { PairingEventsService } from '../../../services/pairing-events.service';
import { TABLET_ENV, type TabletEnv } from '../../../services/tablet-env.token';

/**
 * MQTT do tablete — agenda, comandos, telemetria e entrega de anuncio prioritario.
 *
 * **Um unico transporte: `mqtt.js` sobre WebSocket**, no Android e no navegador.
 *
 * Antes havia dois caminhos, e o nativo (`@capgo/capacitor-mqtt`, que embute o Paho Android)
 * derrubava o aplicativo. O Paho depende de
 * `android.support.v4.content.LocalBroadcastManager`, da Support Library antiga; o projeto e
 * AndroidX sem jetifier, entao a classe nao existe em tempo de execucao e
 * `MqttAndroidClient.connect` lancava `NoClassDefFoundError` numa thread Java — que mata o
 * processo e **nao** passa pelo `try/catch` do JavaScript. Depois disso a limpeza chamava
 * `disconnect()` sobre um cliente inexistente e tomava `NullPointerException` pelo mesmo
 * caminho. Resultado no aparelho: fechava sozinho logo depois do pareamento, sem mensagem.
 *
 * Trocar por WebSocket, em vez de ligar o jetifier, remove a dependencia nativa em vez de
 * remendar uma biblioteca arquivada — e em producao o trafego ja era WebSocket, porque o
 * Cloudflare encaminha WebSocket na 443 mas nao TCP bruto na 1883.
 *
 * O custo conhecido: MQTT em WebView pausa quando o aplicativo vai para segundo plano. Para
 * um player em quiosque, sempre em primeiro plano, isso nao tem efeito pratico; e a sincronia
 * de conteudo nao depende so do MQTT, porque o manifesto tambem e buscado por HTTP.
 */
@Injectable()
export class MqttClientService {
  private readonly env = inject<TabletEnv>(TABLET_ENV);
  private readonly session = inject(DeviceSessionService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  private pairingSub: Subscription | null = null;
  private deviceId: string | null = null;
  private connected = false;
  private connecting = false;
  private intentionalDisconnect = false;

  private mqttJs: MqttClient | null = null;

  private readonly deviceConfigSubject = new ReplaySubject<DeviceConfigPayload>(1);
  private readonly scheduleSubject = new ReplaySubject<SchedulePayload>(1);
  private readonly serverCommandSubject = new Subject<ServerCommandPayload>();
  private readonly priorityCommandSubject = new Subject<
    import('@openad/mqtt-contracts').PriorityCommandPayload
  >();

  readonly deviceConfig$: Observable<DeviceConfigPayload> =
    this.deviceConfigSubject.asObservable();

  readonly schedule$: Observable<SchedulePayload> = this.scheduleSubject.asObservable();

  readonly serverCommand$: Observable<ServerCommandPayload> =
    this.serverCommandSubject.asObservable();

  /** Comandos de prioridade validados (do aparelho ou broadcast). */
  readonly priorityCommand$: Observable<
    import('@openad/mqtt-contracts').PriorityCommandPayload
  > = this.priorityCommandSubject.asObservable();

  constructor() {
    const pairing = inject(PairingEventsService);
    this.pairingSub = pairing.pairingComplete$.subscribe((ev) => {
      void this.attachDevice(ev.deviceId);
    });
    this.destroyRef.onDestroy(() => {
      this.pairingSub?.unsubscribe();
      this.pairingSub = null;
      void this.disconnect();
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getActiveDeviceId(): string | null {
    return this.deviceId;
  }

  async attachDevice(deviceId: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const resolved = await this.resolveBrokerAuth(deviceId);
    if (!resolved) {
      console.warn(
        JSON.stringify({
          event: 'mqtt.skip',
          reason: 'no_broker_url',
        })
      );
      return;
    }
    const { brokerUrl, username, password } = resolved;

    if (this.deviceId === deviceId && this.connected) {
      return;
    }

    await this.disconnect();
    this.deviceId = deviceId;
    this.connecting = true;
    this.intentionalDisconnect = false;
    try {
      /**
       * Seis tentativas com espera exponencial, e nao uma so.
       *
       * O tablete liga junto com o veiculo e a rede movel costuma demorar alguns segundos a
       * mais que o aplicativo. Uma unica tentativa falharia nesse intervalo e o aparelho
       * ficaria sem comando remoto ate alguem reiniciar o app.
       */
      let ultimoErro: unknown;
      for (let tentativa = 0; tentativa < 6; tentativa++) {
        try {
          await this.connectWeb(deviceId, brokerUrl, username, password);
          ultimoErro = undefined;
          break;
        } catch (e) {
          ultimoErro = e;
          if (tentativa < 5) {
            const esperaMs = Math.min(60_000, 1000 * Math.pow(2, tentativa));
            await new Promise((r) => setTimeout(r, esperaMs));
          }
        }
      }
      if (ultimoErro) {
        throw ultimoErro;
      }
      this.connected = true;
    } catch (err) {
      await this.disconnect();
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          event: 'mqtt.connect_failed',
          message,
        })
      );
    } finally {
      this.connecting = false;
    }
  }

  /**
   * URL do broker: a resposta do pareamento primeiro; se o servidor omitir, o `MQTT_URL` do
   * build. Usuario e senha sempre do pareamento quando houver (usuario por aparelho no
   * broker). `MQTT_USERNAME` / `MQTT_PASSWORD` do ambiente so valem quando nao existe
   * pareamento guardado (teste isolado, ou desenvolvimento sem Preferences).
   */
  private async resolveBrokerAuth(
    deviceId: string
  ): Promise<{ brokerUrl: string; username: string; password: string } | null> {
    const stored = await this.session.getMqttFromPairing();
    const envUrl = this.env.MQTT_URL?.trim();

    if (stored && stored.deviceId === deviceId) {
      const brokerUrl = (stored.brokerUrl?.trim() || envUrl) ?? '';
      if (!brokerUrl) {
        return null;
      }
      return {
        brokerUrl,
        username: stored.username ?? '',
        password: stored.password ?? '',
      };
    }

    if (!envUrl) {
      return null;
    }
    return {
      brokerUrl: envUrl,
      username: this.env.MQTT_USERNAME ?? '',
      password: this.env.MQTT_PASSWORD ?? '',
    };
  }

  private async connectWeb(
    deviceId: string,
    brokerUrl: string,
    username: string,
    password: string
  ): Promise<void> {
    const normalizado = normalizarBrokerParaWebSocket(brokerUrl);
    if (normalizado.traduzida) {
      // Aviso, nao erro: a traducao usa a porta padrao do `rabbitmq_web_mqtt`, que acerta em
      // instalacao padrao mas e um palpite. Registrar deixa rastro quando nao acertar.
      console.warn(
        JSON.stringify({
          event: 'mqtt.broker_url_traduzida',
          de: brokerUrl,
          para: normalizado.url,
        })
      );
    }

    /**
     * `connect` pode estar no namespace ou em `default`.
     *
     * O pacote `mqtt` e CommonJS. Com `await import('mqtt')` num bundle ESM, o interop do
     * empacotador as vezes expoe `module.exports` inteiro no namespace e as vezes o pendura
     * em `default`. No navegador de desenvolvimento caiu no primeiro caso; no WebView do
     * tablete, no segundo — e `mqtt.connect(...)` falhou com
     * `(intermediate value).connect is not a function`, derrubando a conexao MQTT sem que
     * nada no codigo estivesse logicamente errado.
     *
     * Resolver os dois formatos e mais barato que depender do empacotador.
     */
    const mod = (await import('mqtt')) as unknown as {
      connect?: typeof import('mqtt').connect;
      default?: { connect?: typeof import('mqtt').connect };
    };
    const conectar = mod.connect ?? mod.default?.connect;
    if (typeof conectar !== 'function') {
      throw new Error('biblioteca mqtt sem funcao connect (interop ESM/CJS)');
    }

    const client = conectar(normalizado.url, {
      clientId: `openad-${deviceId}`,
      username,
      password,
      // Reconexao propria, abaixo: a do `mqtt.js` nao tem recuo exponencial.
      reconnectPeriod: 0,
    });
    this.mqttJs = client;

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('MQTT connect timeout (30s)')),
        30_000
      );
      client.once('connect', () => {
        clearTimeout(t);
        resolve();
      });
      client.once('error', (err) => {
        clearTimeout(t);
        reject(err);
      });
    });

    client.on('message', (topic, payload) => {
      this.dispatchIncoming(topic, payload.toString('utf8'));
    });

    let backoffAttempt = 0;
    client.on('close', () => {
      if (this.intentionalDisconnect || !this.deviceId) {
        return;
      }
      const delayMs = Math.min(60_000, 1000 * Math.pow(2, backoffAttempt));
      backoffAttempt += 1;
      setTimeout(() => {
        if (!this.intentionalDisconnect && this.mqttJs === client) {
          const r = client as { reconnect?: () => void };
          r.reconnect?.();
        }
      }, delayMs);
    });

    client.on('connect', () => {
      backoffAttempt = 0;
    });

    const topics = [
      OpenAdMqttTopics.deviceConfig(deviceId),
      OpenAdMqttTopics.schedule(deviceId),
      OpenAdMqttTopics.commands(deviceId),
      OpenAdMqttTopics.priorityDevice(deviceId),
      OpenAdMqttTopics.priorityBroadcast(),
    ];
    await new Promise<void>((resolve, reject) => {
      client.subscribe(topics, { qos: 1 }, (err) =>
        err ? reject(err) : resolve()
      );
    });
  }

  private dispatchIncoming(topic: string, message: string): void {
    const id = this.deviceId;
    if (!id) {
      return;
    }
    try {
      if (topic === OpenAdMqttTopics.deviceConfig(id)) {
        const data = JSON.parse(message) as DeviceConfigPayload;
        this.deviceConfigSubject.next(data);
        return;
      }
      if (topic === OpenAdMqttTopics.schedule(id)) {
        const parsed = schedulePayloadSchema.safeParse(JSON.parse(message));
        if (parsed.success) {
          this.scheduleSubject.next(parsed.data);
        }
        return;
      }
      if (topic === OpenAdMqttTopics.commands(id)) {
        const parsed = serverCommandPayloadSchema.safeParse(JSON.parse(message));
        if (parsed.success) {
          this.serverCommandSubject.next(parsed.data);
        }
        return;
      }
      if (
        topic === OpenAdMqttTopics.priorityDevice(id) ||
        topic === OpenAdMqttTopics.priorityBroadcast()
      ) {
        const parsed = priorityCommandSchema.safeParse(JSON.parse(message));
        if (parsed.success) {
          this.priorityCommandSubject.next(parsed.data);
        }
        return;
      }
    } catch {
      /* payload malformado */
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.connected = false;
    this.deviceId = null;

    if (this.mqttJs) {
      this.mqttJs.removeAllListeners();
      this.mqttJs.end(true);
      this.mqttJs = null;
    }
  }

  async publishTelemetry(payload: TelemetryPayload): Promise<void> {
    await this.publishJson(OpenAdMqttTopics.telemetry, payload, 0, false);
  }

  async publishImpression(payload: ImpressionPayload): Promise<void> {
    await this.publishJson(OpenAdMqttTopics.impressions, payload, 2, false);
  }

  async publishSpatialLedgerBatch(payload: SpatialLedgerBatch): Promise<void> {
    await this.publishJson(OpenAdMqttTopics.spatialLedger, payload, 1, false);
  }

  async publishCommandAck(payload: CommandAckPayload): Promise<void> {
    await this.publishJson(OpenAdMqttTopics.commandAck, payload, 1, false);
  }

  async publishHeartbeat(payload: HeartbeatPayload): Promise<void> {
    await this.publishJson(OpenAdMqttTopics.deviceHeartbeat, payload, 1, false);
  }

  /** Ciclo de vida do anuncio prioritario — `PriorityCommandsGateway` consome no broker. */
  async publishPriorityAck(payload: PriorityAckPayload): Promise<void> {
    await this.publishJson(OpenAdMqttTopics.priorityAck, payload, 1, false);
  }

  async publishPowerState(body: { engineOn: boolean }): Promise<void> {
    const id = this.deviceId;
    if (!id || !this.connected) {
      return;
    }
    const payload: PowerStatePayload = {
      deviceId: id,
      engineOn: body.engineOn,
      detectionMethod: 'power_disconnect',
      timestamp: new Date().toISOString(),
    };
    await this.publishJson(OpenAdMqttTopics.devicePowerState, payload, 1, false);
  }

  private async publishJson(
    topicFn: (deviceId: string) => string,
    payload: unknown,
    qos: 0 | 1 | 2,
    retained: boolean
  ): Promise<void> {
    const id = this.deviceId;
    if (!id || !this.connected || this.connecting) {
      return;
    }
    const topic = topicFn(id);
    const body = JSON.stringify(payload);

    const client = this.mqttJs;
    if (!client) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, body, { qos, retain: retained }, (err) =>
        err ? reject(err) : resolve()
      );
    });
  }
}
