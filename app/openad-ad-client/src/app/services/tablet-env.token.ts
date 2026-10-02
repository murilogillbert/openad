import { InjectionToken } from '@angular/core';

export interface TabletEnv {
  POWER_ENGINE_OFF_GRACE_MS?: number;
  API_BASE_URL?: string;
  /**
   * Broker base URL when the pairing handshake does not include one: native `mqtt://` /
   * `mqtts://`; browser dev `ws://` / `wss://`. With stored pairing, credentials come
   * from the server only; these two are for unpaired / test scenarios.
   */
  MQTT_URL?: string;
  MQTT_USERNAME?: string;
  MQTT_PASSWORD?: string;
}

function envString(key: string): string | undefined {
  const p = (globalThis as unknown as { process?: { env?: Record<string, string> } })
    .process?.env?.[key];
  return typeof p === 'string' ? p : undefined;
}

export const TABLET_ENV = new InjectionToken<TabletEnv>('TABLET_ENV', {
  factory: (): TabletEnv => {
    const graceRaw = envString('POWER_ENGINE_OFF_GRACE_MS');
    const mqttUrl = envString('MQTT_URL')?.trim();
    return {
      POWER_ENGINE_OFF_GRACE_MS:
        graceRaw !== undefined ? Number(graceRaw) || 30_000 : 30_000,
      API_BASE_URL:
        envString('API_BASE_URL') ?? 'http://127.0.0.1:3000/api/v1',
      MQTT_URL: mqttUrl,
      MQTT_USERNAME: envString('MQTT_USERNAME'),
      MQTT_PASSWORD: envString('MQTT_PASSWORD'),
    };
  },
});
