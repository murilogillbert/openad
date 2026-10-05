import { describe, expect, it } from 'vitest';
import { resolverApiBaseUrl } from './tablet-env.token';

/**
 * O player ja foi a campo com `API_BASE_URL` apontando para `127.0.0.1`.
 *
 * A causa: a leitura era `process.env[key]`, por chave **dinamica**, dentro do Capacitor —
 * onde `process.env` nao existe em tempo de execucao e que nenhum compilador consegue
 * substituir. O tablet nao pareava, nao baixava manifesto e nao reportava exibicao, sem nada
 * na tela que indicasse o motivo. Estes testes fixam a precedencia da correcao.
 */
describe('resolverApiBaseUrl', () => {
  it('a constante de build tem precedencia', () => {
    expect(
      resolverApiBaseUrl({
        deBuild: 'https://adsapi.opendriver.com.br/api/v1',
        doProcesso: 'http://nao-use',
      })
    ).toBe('https://adsapi.opendriver.com.br/api/v1');
  });

  it('cai em process.env quando nao houve define (SSR, node, teste)', () => {
    expect(
      resolverApiBaseUrl({ deBuild: undefined, doProcesso: 'http://127.0.0.1:3000/api/v1' })
    ).toBe('http://127.0.0.1:3000/api/v1');
  });

  it('ignora valor vazio ou so espaco, em vez de aceitar base vazia', () => {
    // Base vazia montaria URLs como "/api/v1/manifest" e falharia de forma obscura.
    expect(resolverApiBaseUrl({ deBuild: '', doProcesso: '   ' })).toBe(
      'http://127.0.0.1:3000/api/v1'
    );
  });

  it('apara espacos da constante', () => {
    expect(resolverApiBaseUrl({ deBuild: '  https://x.teste/api/v1  ' })).toBe(
      'https://x.teste/api/v1'
    );
  });

  it('sem nenhuma fonte, usa o padrao local', () => {
    expect(resolverApiBaseUrl({})).toBe('http://127.0.0.1:3000/api/v1');
  });
});
