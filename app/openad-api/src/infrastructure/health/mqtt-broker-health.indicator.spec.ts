import { MqttBrokerHealthIndicator } from './mqtt-broker-health.indicator';

describe('MqttBrokerHealthIndicator', () => {
  const origFetch = global.fetch;
  const envBefore = { ...process.env };

  afterEach(() => {
    global.fetch = origFetch;
    process.env = { ...envBefore };
  });

  it('returns up when MQTT_HEALTH_DISABLED=true', async () => {
    process.env.MQTT_HEALTH_DISABLED = 'true';
    const ind = new MqttBrokerHealthIndicator();
    const r = await ind.isHealthy('mqtt');
    expect(r).toMatchObject({
      mqtt: { status: 'up' },
    });
  });

  it('checks generic HTTP URL when MQTT_HEALTH=http', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    delete process.env.MQTT_HEALTH_DISABLED;
    process.env.MQTT_HEALTH = 'http';
    process.env.MQTT_HTTP_CHECK_URL = 'http://broker.local/health';
    const ind = new MqttBrokerHealthIndicator();
    const r = await ind.isHealthy('mqtt');
    expect(r).toMatchObject({ mqtt: { status: 'up' } });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://broker.local/health',
      expect.any(Object)
    );
  });

  it('checks RabbitMQ management by default', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    delete process.env.MQTT_HEALTH_DISABLED;
    delete process.env.MQTT_HEALTH;
    process.env.MQTT_MANAGEMENT_USER = 'u';
    process.env.MQTT_MANAGEMENT_PASSWORD = 'p';
    process.env.MQTT_MANAGEMENT_URL = 'http://127.0.0.1:15672';
    const ind = new MqttBrokerHealthIndicator();
    const r = await ind.isHealthy('mqtt');
    expect(r).toMatchObject({ mqtt: { status: 'up' } });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:15672/api/health/checks/alarms',
      expect.any(Object)
    );
  });

});
