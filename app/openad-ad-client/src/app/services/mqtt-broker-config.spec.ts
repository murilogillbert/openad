import { describe, expect, it } from 'vitest';
import { parseBrokerForCapgo } from './mqtt-broker-config';

describe('parseBrokerForCapgo', () => {
  it('traduz mqtt:// para tcp:// com a porta separada', () => {
    expect(parseBrokerForCapgo('mqtt://broker.local:1884')).toEqual({
      serverURI: 'tcp://broker.local',
      port: 1884,
    });
  });

  it('traduz mqtts:// para ssl:// e assume 8883', () => {
    expect(parseBrokerForCapgo('mqtts://broker.local')).toEqual({
      serverURI: 'ssl://broker.local',
      port: 8883,
    });
  });

  it('preserva o caminho do WebSocket, que e como o rabbitmq_web_mqtt atende', () => {
    // Caminho de producao: Cloudflare na 443, `rabbitmq_web_mqtt` servindo em /ws.
    // Perder o `/ws` faz o handshake bater na raiz e a conexao ser recusada.
    expect(parseBrokerForCapgo('wss://mqtt.opendriver.com.br/ws')).toEqual({
      serverURI: 'wss://mqtt.opendriver.com.br/ws',
      port: 443,
    });
  });

  it('nao acrescenta caminho quando a URL nao tem um', () => {
    expect(parseBrokerForCapgo('wss://mqtt.opendriver.com.br')).toEqual({
      serverURI: 'wss://mqtt.opendriver.com.br',
      port: 443,
    });
  });

  it('respeita porta explicita no WebSocket', () => {
    expect(parseBrokerForCapgo('ws://127.0.0.1:15675/ws')).toEqual({
      serverURI: 'ws://127.0.0.1/ws',
      port: 15675,
    });
  });

  it('recusa esquema que o cliente nativo nao sabe falar', () => {
    expect(() => parseBrokerForCapgo('https://broker.local')).toThrow(
      /Unsupported MQTT broker URL/
    );
  });
});
