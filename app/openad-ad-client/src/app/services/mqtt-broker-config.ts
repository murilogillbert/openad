/**
 * Parse broker URL for @capgo/capacitor-mqtt (Paho expects `tcp://host` + port, or `ssl://`).
 * For `mqtt.js` (web dev) the original `mqtt://` / `ws://` string is used as-is.
 */
export function parseBrokerForCapgo(mqttUrl: string): {
  serverURI: string;
  port: number;
} {
  const u = new URL(mqttUrl);
  const defaultPort =
    u.protocol === 'mqtts:'
      ? 8883
      : u.protocol === 'mqtt:'
        ? 1883
        : u.protocol === 'wss:'
          ? 443
          : u.protocol === 'ws:'
            ? 80
            : 1883;
  const port = u.port ? parseInt(u.port, 10) : defaultPort;
  const host = u.hostname;

  if (u.protocol === 'mqtt:' || u.protocol === 'mqtts:') {
    const scheme = u.protocol === 'mqtts:' ? 'ssl' : 'tcp';
    return { serverURI: `${scheme}://${host}`, port };
  }

  if (u.protocol === 'ws:' || u.protocol === 'wss:') {
    return { serverURI: `${u.protocol}//${host}`, port };
  }

  throw new Error(`Unsupported MQTT broker URL for native client: ${mqttUrl}`);
}
