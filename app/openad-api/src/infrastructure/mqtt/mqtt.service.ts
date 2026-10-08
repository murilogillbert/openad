import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { DeviceConfigPayload } from '@openad/mqtt-contracts';
import * as fs from 'fs';
import { connect, type IClientOptions, MqttClient } from 'mqtt';
import {
  mqttBrokerUrlWithoutUserinfo,
  mqttUrlForLog,
} from '../rabbitmq/mqtt-env-credentials.util';

export type MqttMessageHandler = (topic: string, payload: Buffer) => void;

type Subscription = { pattern: string; handler: MqttMessageHandler };

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: MqttClient | null = null;
  private readonly subscriptions: Subscription[] = [];
  private messageListenerAttached = false;

  onModuleInit(): void {
    const rawUrl = (process.env.MQTT_URL ?? '').trim();
    if (!rawUrl) {
      throw new Error(
        'MQTT_URL is required. Start the API via `pnpm api:serve` (dotenvx) or export MQTT_URL before running.'
      );
    }

    const explicitUser = (process.env.MQTT_USERNAME ?? '').trim() || undefined;
    const explicitPass = (process.env.MQTT_PASSWORD ?? '').trim() || undefined;

    const opts: IClientOptions = {
      reconnectPeriod: 5000,
    };

    /** When `MQTT_USERNAME` + `MQTT_PASSWORD` are set, pass them as options and strip URL userinfo (matches seed + docs). */
    let connectUrl = rawUrl;
    if (explicitUser && explicitPass) {
      connectUrl = mqttBrokerUrlWithoutUserinfo(rawUrl);
      opts.username = explicitUser;
      opts.password = explicitPass;
    }

    const caPath = (process.env.MQTT_TLS_CA ?? '').trim() || undefined;
    const certPath = (process.env.MQTT_TLS_CERT ?? '').trim() || undefined;
    const keyPath = (process.env.MQTT_TLS_KEY ?? '').trim() || undefined;

    const rejectUnauthorized =
      (process.env.MQTT_TLS_REJECT_UNAUTHORIZED ?? '').toLowerCase() !== 'false';

    if (caPath) {
      opts.ca = fs.readFileSync(caPath);
    }
    if (certPath && keyPath) {
      opts.cert = fs.readFileSync(certPath);
      opts.key = fs.readFileSync(keyPath);
    } else if (certPath || keyPath) {
      this.logger.warn(
        'MQTT_TLS_CERT and MQTT_TLS_KEY must both be set for mTLS; ignoring partial client cert config'
      );
    }

    opts.rejectUnauthorized = rejectUnauthorized;

    this.client = connect(connectUrl, opts);

    const logUrl = mqttUrlForLog(connectUrl);
    this.client.on('connect', () => {
      const authNote =
        explicitUser && explicitPass
          ? ' (credentials from MQTT_USERNAME / MQTT_PASSWORD)'
          : '';
      this.logger.log(`MQTT connected to ${logUrl}${authNote}`);
    });
    this.client.on('error', (err) => {
      this.logger.error(`MQTT error: ${err.message}`);
    });
    this.client.on('reconnect', () => {
      this.logger.warn('MQTT reconnecting…');
    });
  }

  onModuleDestroy(): void {
    this.client?.end(true);
    this.client = null;
  }

  private get connected(): MqttClient {
    if (!this.client) {
      throw new Error('MQTT client not initialized');
    }
    return this.client;
  }

  private ensureMessageListener(): void {
    if (this.messageListenerAttached) return;
    this.connected.on('message', (topic, payload) => {
      for (const sub of this.subscriptions) {
        if (this.topicMatches(topic, sub.pattern)) {
          sub.handler(topic, payload);
        }
      }
    });
    this.messageListenerAttached = true;
  }

  publish(
    topic: string,
    payload: string | Buffer | object,
    qos: 0 | 1 | 2 = 1,
    retain = false
  ): Promise<void> {
    const body =
      typeof payload === 'object' && !Buffer.isBuffer(payload)
        ? JSON.stringify(payload)
        : payload;
    return new Promise((resolve, reject) => {
      this.connected.publish(topic, body, { qos, retain }, (err) =>
        err ? reject(err) : resolve()
      );
    });
  }

  /**
   * `true` quando esta instância **não** deve consumir tópicos MQTT.
   *
   * ============================================================================
   * O problema (item G.2 do plano v2)
   * ============================================================================
   *
   * Cinco serviços assinam o mesmo tópico em **toda** instância da API: ack de comando,
   * telemetria, impressões, comandos prioritários e o livro espacial. Com N réplicas, cada
   * mensagem é entregue e processada N vezes.
   *
   * Impressões e plays são idempotentes por índice único, então ali o efeito é só trabalho
   * duplicado. Nos outros três não: o ack de comando e os comandos prioritários produzem
   * escrita e notificação por mensagem.
   *
   * ============================================================================
   * Por que a flag, e não `$share`
   * ============================================================================
   *
   * `$share/<grupo>/<tópico>` do MQTT 5 resolveria isso no broker, distribuindo cada mensagem a
   * um só assinante do grupo. Mas o broker em produção é o RabbitMQ 4.3.6 com `rabbitmq_mqtt`, e
   * **o suporte a assinatura compartilhada não está confirmado**: a issue 8936 do
   * rabbitmq-server pediu o recurso e o MQTT 5.0 que entrou no 3.13 deixou shared subscriptions
   * de fora. Usar `$share` sem confirmar significaria assinar um tópico literal chamado
   * `$share/...`, que nunca casa com nada — e a ingestão pararia **em silêncio**.
   *
   * A flag é a primeira opção do próprio plano ("ingestão MQTT numa instância só") e funciona
   * independentemente do broker. O custo é operacional: ao subir a segunda réplica, ela precisa
   * de `OPENAD_MQTT_INGEST_DISABLED=true`.
   *
   * Padrão **ligado**, para o comportamento de hoje (uma instância) não mudar.
   */
  private get ingestaoDesligada(): boolean {
    return process.env.OPENAD_MQTT_INGEST_DISABLED === 'true';
  }

  subscribe(
    topicPattern: string,
    handler: MqttMessageHandler,
    qos: 0 | 1 | 2 = 1
  ): void {
    if (this.ingestaoDesligada) {
      /**
       * Nem registra o handler, nem assina.
       *
       * Registrar o handler sem assinar seria pior do que parece: o `ensureMessageListener`
       * despacha por correspondência de padrão sobre `this.subscriptions`, então um handler
       * registrado passaria a receber mensagem de **outra** assinatura cujo padrão casasse.
       */
      this.logger.warn(
        { event: 'mqtt.ingestao_desligada', topicPattern },
        'OPENAD_MQTT_INGEST_DISABLED=true: esta instancia nao consome este topico'
      );
      return;
    }

    this.ensureMessageListener();
    this.subscriptions.push({ pattern: topicPattern, handler });
    this.connected.subscribe(topicPattern, { qos }, (err) => {
      if (err) {
        this.logger.error(`MQTT subscribe failed: ${err.message}`);
      }
    });
  }

  /** Pushes configuration profile payload to the device (retained QoS 1). */
  async publishDeviceConfig(
    deviceId: string,
    payload: DeviceConfigPayload
  ): Promise<void> {
    const topic = `devices/${deviceId}/config`;
    await this.publish(topic, payload, 1, true);
    this.logger.log(
      { event: 'device.config.push', deviceId, topic },
      'published device config'
    );
  }

  /** Minimal wildcard match for `+` and `#` (MQTT topic patterns). */
  private topicMatches(topic: string, pattern: string): boolean {
    if (pattern === topic) return true;
    const p = pattern.split('/');
    const t = topic.split('/');
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '#') return true;
      if (p[i] === '+') continue;
      if (p[i] !== t[i]) return false;
    }
    return p.length === t.length;
  }
}
