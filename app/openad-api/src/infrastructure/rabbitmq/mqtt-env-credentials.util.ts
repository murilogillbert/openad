/**
 * Resolves MQTT broker login used by the API (`MqttService`) from the same env as production:
 * `MQTT_USERNAME` + `MQTT_PASSWORD`, or userinfo embedded in `MQTT_URL`.
 */
export function mqttLoginFromEnv(): { username: string; password: string } | null {
  const explicitUser = (process.env.MQTT_USERNAME ?? '').trim();
  const explicitPass = (process.env.MQTT_PASSWORD ?? '').trim();
  if (explicitUser && explicitPass) {
    return { username: explicitUser, password: explicitPass };
  }

  const raw = (process.env.MQTT_URL ?? '').trim();
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    const username = decodeURIComponent(url.username || '');
    const password = decodeURIComponent(url.password || '');
    if (username && password) {
      return { username, password };
    }
  } catch {
    return null;
  }
  return null;
}

/** Strip userinfo so credentials can be passed via `mqtt` client options (avoids duplicate auth). */
export function mqttBrokerUrlWithoutUserinfo(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/** Safe broker URL for logs (password redacted). */
export function mqttUrlForLog(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.password) {
      u.password = '***';
    }
    return u.toString();
  } catch {
    return '[mqtt url]';
  }
}
