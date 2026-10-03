import { RequestMethod, type INestApplication } from '@nestjs/common';

/**
 * Prefixo global e as rotas que ficam **fora** dele.
 *
 * Existe num lugar só porque `main.ts` e `test/test-app.factory.ts` precisam aplicar
 * **exatamente** a mesma configuração. Antes, o factory de teste chamava
 * `app.setGlobalPrefix('api/v1')` sem a lista de exclusões: as rotas excluídas respondiam num
 * caminho no teste e em outro em produção.
 *
 * O custo dessa divergência é um teste que passa afirmando a coisa errada. As páginas legais
 * são o caso mais caro: elas vão para a ficha da loja, a revisão da Apple **abre** os links, e
 * o teste diria que estão no ar enquanto em produção estariam 404 — ou o contrário.
 *
 * Quem acrescentar exclusão, acrescente aqui.
 */
export const PREFIXO_GLOBAL = 'api/v1';

export const ROTAS_FORA_DO_PREFIXO = [
  // Sonda de saúde. Fica fora para o orquestrador não depender da versão da API.
  { path: 'api/health', method: RequestMethod.ALL },

  // Swagger e métricas: superfície de operação, não de produto.
  { path: 'api/docs', method: RequestMethod.ALL },
  { path: 'api/docs-json', method: RequestMethod.GET },
  { path: 'api/metrics', method: RequestMethod.GET },

  /**
   * Páginas legais. `/api/v1/legal/privacidade` seria um endereço que quebra no dia em que a
   * API ganhar `v2` — e quem descobre é o revisor da loja abrindo um link morto, numa rodada
   * de revisão que leva dias.
   */
  { path: 'legal/privacidade', method: RequestMethod.GET },
  { path: 'legal/termos', method: RequestMethod.GET },
] as const;

/** Aplica o prefixo e as exclusões. Use nos dois lugares; não repita a configuração. */
export function aplicarPrefixoGlobal(app: INestApplication): void {
  app.setGlobalPrefix(PREFIXO_GLOBAL, {
    exclude: [...ROTAS_FORA_DO_PREFIXO],
  });
}
