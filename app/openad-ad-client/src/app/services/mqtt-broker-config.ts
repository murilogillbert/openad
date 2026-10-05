/**
 * Normaliza a URL do broker para **MQTT sobre WebSocket**, que e o unico transporte que o
 * player usa.
 *
 * Por que so WebSocket, e nao mais TCP nativo: o cliente nativo era o `@capgo/capacitor-mqtt`,
 * que embute o Paho Android. O Paho depende de
 * `android.support.v4.content.LocalBroadcastManager`, classe da Support Library antiga; este
 * projeto e AndroidX (`android.useAndroidX=true`, sem jetifier), entao a classe nao existe em
 * tempo de execucao e `MqttAndroidClient.connect` morria com `NoClassDefFoundError` numa
 * thread Java — matando o processo inteiro, sem passar pelo `try/catch` do JavaScript. Em
 * seguida a limpeza chamava `disconnect()` sobre um cliente que nunca foi criado e tomava um
 * `NullPointerException` pelo mesmo caminho. O tablete fechava sozinho logo depois do
 * pareamento, sem mensagem.
 *
 * A alternativa seria ligar o jetifier para reescrever o bytecode do Paho. Foi recusada: o
 * jetifier e depreciado e manteria viva uma biblioteca arquivada, para um transporte que o
 * player nao precisa. Em producao o trafego ja passa por WebSocket de qualquer forma — o
 * Cloudflare encaminha HTTP e WebSocket na 443, mas nao TCP bruto na 1883/8883.
 *
 * O caminho da URL e preservado: o `rabbitmq_web_mqtt` atende em `/ws` por padrao, e perder
 * esse trecho faz o handshake bater na raiz e a conexao ser recusada.
 */

/** Porta padrao do plugin `rabbitmq_web_mqtt`. */
const PORTA_WEB_MQTT = 15675;

export interface BrokerWebSocket {
  /** URL completa, pronta para `mqtt.connect`. */
  url: string;
  /** True quando a URL de entrada era TCP e precisou ser traduzida. */
  traduzida: boolean;
}

/**
 * Devolve uma URL `ws://` ou `wss://`.
 *
 * `ws:`/`wss:` passam intactas. `mqtt:`/`mqtts:` sao traduzidas: o esquema vira `ws`/`wss`, a
 * porta vira {@link PORTA_WEB_MQTT} e o caminho vira `/ws`.
 *
 * A porta TCP e **descartada** de proposito. Um `mqtt://host:1883` aponta para o listener TCP,
 * que nao fala WebSocket; manter a porta produziria uma URL que falha no handshake. Trocar
 * pela porta padrao do `web_mqtt` e um palpite, mas e o palpite certo em toda instalacao
 * padrao do RabbitMQ — e vem com `traduzida: true`, para quem chama poder registrar o aviso.
 */
export function normalizarBrokerParaWebSocket(mqttUrl: string): BrokerWebSocket {
  const u = new URL(mqttUrl);

  if (u.protocol === 'ws:' || u.protocol === 'wss:') {
    return { url: u.toString(), traduzida: false };
  }

  if (u.protocol === 'mqtt:' || u.protocol === 'mqtts:') {
    const esquema = u.protocol === 'mqtts:' ? 'wss' : 'ws';
    const caminho = u.pathname && u.pathname !== '/' ? u.pathname : '/ws';
    return {
      url: `${esquema}://${u.hostname}:${PORTA_WEB_MQTT}${caminho}`,
      traduzida: true,
    };
  }

  throw new Error(`URL de broker MQTT nao suportada: ${mqttUrl}`);
}
