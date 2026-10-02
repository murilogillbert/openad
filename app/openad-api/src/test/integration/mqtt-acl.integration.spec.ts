import * as mqtt from 'mqtt';

/**
 * Requires an MQTT broker with ACL expectations (historically EMQX + `docker/emqx/acl.conf`; optional).
 * Set `MQTT_ACL_TEST=true` and ensure broker is reachable (`MQTT_TEST_URI`).
 */
const enabled = process.env.MQTT_ACL_TEST === 'true';

(enabled ? describe : describe.skip)('MQTT ACL (EMQX)', () => {
  const url =
    process.env.MQTT_TEST_URI ??
    'mqtt://openad:openad-dev-mqtt@127.0.0.1:1884';

  it(
    'client cannot publish to another device topic',
    async () => {
      const deviceA = 'aaaaaaaa-bbbb-4ccc-dddd-aaaaaaaaaaaa';
      const deviceB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

      const clientA = mqtt.connect(url, {
        clientId: deviceA,
        protocolVersion: 5,
        reconnectPeriod: 0,
      });

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('connect timeout')), 10_000);
        clientA.once('connect', () => {
          clearTimeout(t);
          resolve();
        });
        clientA.once('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });

      const badPublish = await new Promise<{ ok: boolean; err?: Error }>(
        (resolve) => {
          clientA.publish(
            `openad/${deviceB}/impressions`,
            JSON.stringify({ ping: 1 }),
            { qos: 1 },
            (err) => {
              clientA.end(true);
              resolve({ ok: !err, err: err ?? undefined });
            }
          );
        }
      );

      // With ACL, publish to foreign topic should fail (callback err or broker disconnect).
      expect(badPublish.ok).toBe(false);
    },
    20_000
  );
});
