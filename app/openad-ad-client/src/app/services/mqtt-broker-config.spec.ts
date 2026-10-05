import { describe, expect, it } from 'vitest';
import { normalizarBrokerParaWebSocket } from './mqtt-broker-config';

describe('normalizarBrokerParaWebSocket', () => {
  it('mantem wss:// com caminho intacto', () => {
    // Caminho de producao: Cloudflare na 443, `rabbitmq_web_mqtt` servindo em /ws.
    // Perder o `/ws` faz o handshake bater na raiz e a conexao ser recusada.
    expect(normalizarBrokerParaWebSocket('wss://mqtt.opendriver.com.br/ws')).toEqual({
      url: 'wss://mqtt.opendriver.com.br/ws',
      traduzida: false,
    });
  });

  it('mantem ws:// com porta explicita', () => {
    expect(normalizarBrokerParaWebSocket('ws://127.0.0.1:15675/ws')).toEqual({
      url: 'ws://127.0.0.1:15675/ws',
      traduzida: false,
    });
  });

  it('traduz mqtt:// para ws:// na porta do web_mqtt, descartando a porta TCP', () => {
    // A 1883 e o listener TCP e nao fala WebSocket; manter a porta daria uma URL que falha
    // no handshake.
    expect(normalizarBrokerParaWebSocket('mqtt://broker.local:1883')).toEqual({
      url: 'ws://broker.local:15675/ws',
      traduzida: true,
    });
  });

  it('traduz mqtts:// para wss://', () => {
    expect(normalizarBrokerParaWebSocket('mqtts://broker.local')).toEqual({
      url: 'wss://broker.local:15675/ws',
      traduzida: true,
    });
  });

  it('preserva caminho informado ao traduzir', () => {
    expect(normalizarBrokerParaWebSocket('mqtt://broker.local/mqtt')).toEqual({
      url: 'ws://broker.local:15675/mqtt',
      traduzida: true,
    });
  });

  it('recusa esquema que nao e MQTT nem WebSocket', () => {
    expect(() => normalizarBrokerParaWebSocket('https://broker.local')).toThrow(
      /nao suportada/
    );
  });
});
