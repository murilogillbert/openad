/**
 * Traduz a URL do broker para o formato que o `@capgo/capacitor-mqtt` (Paho) espera:
 * `tcp://host` ou `ssl://host` para MQTT puro, `ws://host` ou `wss://host` para WebSocket,
 * sempre com a porta separada.
 *
 * Para o `mqtt.js` (desenvolvimento no navegador) a string original e usada como esta.
 *
 * **O caminho e preservado.** Isso importa em producao atras do Cloudflare: o proxy dele
 * encaminha HTTP e WebSocket na 443, mas nao TCP bruto na 1883/8883, entao o tablete fala
 * MQTT sobre WebSocket. E o `rabbitmq_web_mqtt` serve em `/ws` por padrao — descartar o
 * caminho faria o handshake bater na raiz e a conexao ser recusada. A versao anterior usava
 * so `u.hostname` e perdia o `/ws`.
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
    // MQTT puro nao tem caminho: um `/algo` aqui seria sempre erro de configuracao.
    const scheme = u.protocol === 'mqtts:' ? 'ssl' : 'tcp';
    return { serverURI: `${scheme}://${host}`, port };
  }

  if (u.protocol === 'ws:' || u.protocol === 'wss:') {
    // `new URL('wss://host').pathname` e `/`, que nao acrescenta nada ao serverURI.
    const caminho = u.pathname === '/' ? '' : u.pathname;
    return { serverURI: `${u.protocol}//${host}${caminho}`, port };
  }

  throw new Error(`Unsupported MQTT broker URL for native client: ${mqttUrl}`);
}
