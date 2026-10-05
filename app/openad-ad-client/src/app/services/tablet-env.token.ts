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

/**
 * Valores injetados pelo `define` do builder, em tempo de build.
 *
 * `declare const` sem implementação: o esbuild substitui o identificador pelo literal, e as
 * leituras abaixo são sempre protegidas por `typeof`, que é seguro em identificador não
 * declarado — é o que permite o mesmo código rodar no teste e no SSR, onde o `define` não
 * passou.
 */
declare const __OPENAD_API_BASE_URL__: string;
/**
 * Vazio no build de produção, de propósito: o endereço do broker vem do pareamento
 * (`mqtt.brokerUrl` na resposta do bind). Existe no `define` só para não deixar
 * identificador sem substituição dentro do bundle.
 */
declare const __OPENAD_MQTT_URL__: string;

function constanteDeBuild(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

/**
 * Resolve o endereço da API do tablet, em ordem de precedência.
 *
 * **Por que não bastava `process.env`**: o player roda dentro do Capacitor, onde não existe
 * `process.env` em tempo de execução, e a leitura original era por **chave dinâmica**
 * (`process.env[key]`), que nenhum compilador consegue substituir — nem o `define` do
 * builder. O resultado é que `API_BASE_URL` caía sempre no padrão `127.0.0.1`, ou seja, o
 * próprio tablet: o aparelho não pareava, não baixava manifesto e não reportava exibição, e
 * nada na tela sugeria o motivo. A constante de build resolve porque é um identificador
 * estático, substituível.
 *
 * `process.env` continua antes do padrão para servir ao build de SSR e ao desenvolvimento
 * em Node, onde ele existe de verdade.
 */
export function resolverApiBaseUrl(fontes: {
  deBuild?: string | undefined;
  doProcesso?: string | undefined;
}): string {
  return (
    constanteDeBuild(fontes.deBuild) ??
    constanteDeBuild(fontes.doProcesso) ??
    'http://127.0.0.1:3000/api/v1'
  );
}

export const TABLET_ENV = new InjectionToken<TabletEnv>('TABLET_ENV', {
  factory: (): TabletEnv => {
    const graceRaw = envString('POWER_ENGINE_OFF_GRACE_MS');
    const apiDeBuild =
      typeof __OPENAD_API_BASE_URL__ !== 'undefined' ? __OPENAD_API_BASE_URL__ : undefined;
    const mqttDeBuild =
      typeof __OPENAD_MQTT_URL__ !== 'undefined' ? __OPENAD_MQTT_URL__ : undefined;
    return {
      POWER_ENGINE_OFF_GRACE_MS:
        graceRaw !== undefined ? Number(graceRaw) || 30_000 : 30_000,
      API_BASE_URL: resolverApiBaseUrl({
        deBuild: apiDeBuild,
        doProcesso: envString('API_BASE_URL'),
      }),
      /**
       * O broker vem do pareamento (`mqtt.brokerUrl` na resposta do bind), então este valor
       * só serve a cenário sem pareamento ou de teste. Sem padrão: um endereço errado aqui
       * faria o cliente tentar um broker inexistente em vez de ficar quieto.
       */
      MQTT_URL: constanteDeBuild(mqttDeBuild) ?? envString('MQTT_URL')?.trim(),
      MQTT_USERNAME: envString('MQTT_USERNAME'),
      MQTT_PASSWORD: envString('MQTT_PASSWORD'),
    };
  },
});
