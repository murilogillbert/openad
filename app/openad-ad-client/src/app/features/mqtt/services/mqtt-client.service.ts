import { isPlatformBrowser } from '@angular/common';
import type { PluginListenerHandle } from '@capacitor/core';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { MqttBridge } from '@capgo/capacitor-mqtt';
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
import { parseBrokerForCapgo } from '../../../services/mqtt-broker-config';
import { OpenAdMqttTopics } from '../../../services/mqtt-topics';
import { PairingEventsService } from '../../../services/pairing-events.service';
import { TABLET_ENV, type TabletEnv } from '../../../services/tablet-env.token';

/**
 * Tablet MQTT — schedules, commands, telemetry, and priority ad delivery.
 * Native: `@capgo/capacitor-mqtt`. Browser: `mqtt` over `ws://` / `wss://`.
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
  private bridgeHandles: PluginListenerHandle[] = [];

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

  /** Validated priority commands (device-specific or broadcast). */
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
      if (this.useNativeBridge()) {
        await this.connectNative(deviceId, brokerUrl, username, password);
      } else {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            await this.connectWeb(deviceId, brokerUrl, username, password);
            lastErr = undefined;
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < 5) {
              const delayMs = Math.min(60_000, 1000 * Math.pow(2, attempt));
              await new Promise((r) => setTimeout(r, delayMs));
            }
          }
        }
        if (lastErr) {
          throw lastErr;
        }
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

  private useNativeBridge(): boolean {
    const p = Capacitor.getPlatform();
    return p === 'android' || p === 'ios';
  }

  /**
   * Broker URL: pairing response first; if the server omits it, build-time `MQTT_URL`.
   * Username/password: always from pairing when present (per-device broker user). Env
   * `MQTT_USERNAME` / `MQTT_PASSWORD` are only used when there is no stored pairing
   * (e.g. isolated tests / dev without Preferences).
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

  private async connectNative(
    deviceId: string,
    brokerUrl: string,
    username: string,
    password: string
  ): Promise<void> {
    const { serverURI, port } = parseBrokerForCapgo(brokerUrl);

    const onMsg = await MqttBridge.addListener('onMessageArrived', (evt) => {
      this.dispatchIncoming(evt.topic, evt.message);
    });
    this.bridgeHandles.push(onMsg);

    await MqttBridge.connect({
      serverURI,
      port,
      clientId: `openad-${deviceId}`,
      username,
      password,
      setCleanSession: true,
      connectionTimeout: 30,
      keepAliveInterval: 60,
      setAutomaticReconnect: true,
    });

    const subs: { topic: string; qos: number }[] = [
      { topic: OpenAdMqttTopics.deviceConfig(deviceId), qos: 1 },
      { topic: OpenAdMqttTopics.schedule(deviceId), qos: 1 },
      { topic: OpenAdMqttTopics.commands(deviceId), qos: 1 },
      { topic: OpenAdMqttTopics.priorityDevice(deviceId), qos: 1 },
      { topic: OpenAdMqttTopics.priorityBroadcast(), qos: 1 },
    ];
    for (const s of subs) {
      await MqttBridge.subscribe(s);
    }
  }

  private async connectWeb(
    deviceId: string,
    brokerUrl: string,
    username: string,
    password: string
  ): Promise<void> {
    const mqtt = await import('mqtt');
    const client = mqtt.connect(brokerUrl, {
      clientId: `openad-${deviceId}`,
      username,
      password,
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
      /* malformed payload */
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

    for (const h of this.bridgeHandles) {
      try {
        await h.remove();
      } catch {
        /* ignore */
      }
    }
    this.bridgeHandles = [];

    if (this.useNativeBridge()) {
      try {
        await MqttBridge.disconnect();
      } catch {
        /* ignore */
      }
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

  /** Priority playback lifecycle — `PriorityCommandsGateway` ingests on broker. */
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

    if (this.useNativeBridge()) {
      await MqttBridge.publish({
        topic,
        payload: body,
        qos,
        retained,
      });
      return;
    }

    const webClient = this.mqttJs;
    if (webClient) {
      await new Promise<void>((resolve, reject) => {
        webClient.publish(topic, body, { qos, retain: retained }, (err) =>
          err ? reject(err) : resolve()
        );
      });
    }
  }
}
