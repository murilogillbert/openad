import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  type HealthIndicatorResult,
} from '@nestjs/terminus';

/** How to verify the broker / control plane is reachable (not the MQTT protocol itself). */
export type MqttHealthMode = 'none' | 'rabbitmq' | 'http';

/**
 * Optional HTTP checks: RabbitMQ management API (local compose), or any broker HTTP status URL.
 */
@Injectable()
export class MqttBrokerHealthIndicator extends HealthIndicator {
  constructor() {
    super();
  }

  private mode(): MqttHealthMode {
    if ((process.env.MQTT_HEALTH_DISABLED ?? '') === 'true') {
      return 'none';
    }
    const raw = (process.env.MQTT_HEALTH ?? '').toLowerCase();
    if (raw === 'none' || raw === 'off') {
      return 'none';
    }
    if (raw === 'http') {
      return 'http';
    }
    if (raw === 'rabbitmq') {
      return 'rabbitmq';
    }
    return 'rabbitmq';
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const mode = this.mode();
    if (mode === 'none') {
      return this.getStatus(key, true, { note: 'skipped' });
    }
    if (mode === 'rabbitmq') {
      return this.checkRabbitmqManagement(key);
    }
    return this.checkHttp(key);
  }

  private async checkHttp(key: string): Promise<HealthIndicatorResult> {
    const url = (process.env.MQTT_HTTP_CHECK_URL ?? '').trim();
    if (!url) {
      throw new HealthCheckError(
        'mqtt http check misconfigured',
        this.getStatus(key, false, {
          message: 'Set MQTT_HTTP_CHECK_URL when MQTT_HEALTH=http',
        })
      );
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        throw new HealthCheckError(
          'mqtt http check failed',
          this.getStatus(key, false, { statusCode: res.status })
        );
      }
      return this.getStatus(key, true, { check: 'http' });
    } catch (e) {
      throw new HealthCheckError(
        'mqtt http check failed',
        this.getStatus(key, false, {
          message: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }

  private async checkRabbitmqManagement(key: string): Promise<HealthIndicatorResult> {
    const user = (process.env.MQTT_MANAGEMENT_USER ?? '').trim() || 'openad';
    const pass =
      (process.env.MQTT_MANAGEMENT_PASSWORD ?? '').trim() || 'openad-dev-mqtt';
    const base =
      (process.env.MQTT_MANAGEMENT_URL ?? '').trim() || 'http://127.0.0.1:15672';
    const url = `${base.replace(/\/$/, '')}/api/health/checks/alarms`;
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        throw new HealthCheckError(
          'rabbitmq management check failed',
          this.getStatus(key, false, { statusCode: res.status })
        );
      }
      return this.getStatus(key, true, { check: 'rabbitmq-management' });
    } catch (e) {
      throw new HealthCheckError(
        'rabbitmq management check failed',
        this.getStatus(key, false, {
          message: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }
}
