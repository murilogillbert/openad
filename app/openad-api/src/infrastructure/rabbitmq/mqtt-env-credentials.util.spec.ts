import {
  mqttBrokerUrlWithoutUserinfo,
  mqttLoginFromEnv,
  mqttUrlForLog,
} from './mqtt-env-credentials.util';

describe('mqttLoginFromEnv', () => {
  const envBefore = { ...process.env };

  afterEach(() => {
    process.env = { ...envBefore };
  });

  it('prefers MQTT_USERNAME / MQTT_PASSWORD over URL', () => {
    process.env.MQTT_USERNAME = 'from-env';
    process.env.MQTT_PASSWORD = 'secret-env';
    process.env.MQTT_URL = 'mqtt://u:p@127.0.0.1:1884';
    expect(mqttLoginFromEnv()).toEqual({
      username: 'from-env',
      password: 'secret-env',
    });
  });

  it('parses userinfo from MQTT_URL', () => {
    delete process.env.MQTT_USERNAME;
    delete process.env.MQTT_PASSWORD;
    process.env.MQTT_URL = 'mqtt://openad:openad-dev-mqtt@127.0.0.1:1884';
    expect(mqttLoginFromEnv()).toEqual({
      username: 'openad',
      password: 'openad-dev-mqtt',
    });
  });

  it('returns null when URL has no credentials', () => {
    delete process.env.MQTT_USERNAME;
    delete process.env.MQTT_PASSWORD;
    process.env.MQTT_URL = 'mqtt://127.0.0.1:1884';
    expect(mqttLoginFromEnv()).toBeNull();
  });
});

describe('mqttBrokerUrlWithoutUserinfo', () => {
  it('strips userinfo', () => {
    expect(
      mqttBrokerUrlWithoutUserinfo('mqtt://openad:secret@127.0.0.1:1884/path')
    ).toBe('mqtt://127.0.0.1:1884/path');
  });
});

describe('mqttUrlForLog', () => {
  it('redacts password', () => {
    expect(mqttUrlForLog('mqtt://u:secret@host:1884/')).toContain('***');
    expect(mqttUrlForLog('mqtt://u:secret@host:1884/')).not.toContain('secret');
  });
});
