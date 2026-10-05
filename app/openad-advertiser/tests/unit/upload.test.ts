import { createUploader, type ArquivoLocal } from '@/api/upload';
import type { RefreshOutcome, TokenStorage } from '@/api/http';

/**
 * O envio de criativo e o unico caminho da API que NAO usa `fetch`.
 *
 * O `fetch` que o Expo instala no lugar do global recusa a parte `{ uri, name, type }` do
 * React Native com `Unsupported FormDataPart implementation`, e isso derrubava todo envio de
 * criativo — de foto de 0,1 MB a video de 93,5 MB — aparecendo na tela como "Sem conexao com
 * o servidor". Estes testes fixam o contrato do enviador por XHR que substituiu aquele
 * caminho: parte no formato do React Native, campo `file`, sem `Content-Type` definido a mao,
 * renovacao de sessao em 401 e traducao de erro de transporte.
 */

function armazenamentoFalso(inicial?: { access?: string; refresh?: string }) {
  let access = inicial?.access ?? null;
  let refresh = inicial?.refresh ?? null;
  const storage: TokenStorage = {
    getAccessToken: async () => access,
    getRefreshToken: async () => refresh,
    setTokens: async ({ token, refreshToken }) => {
      access = token;
      refresh = refreshToken;
    },
    clear: async () => {
      access = null;
      refresh = null;
    },
  };
  return { storage, atual: () => ({ access, refresh }), trocar: (a: string) => (access = a) };
}

type Comportamento =
  | { tipo: 'responder'; status: number; corpo?: string }
  | { tipo: 'erro' }
  | { tipo: 'timeout' };

/** XHR falso, suficiente para o que o enviador usa. */
function xhrFalso(roteiro: Comportamento[]) {
  const chamadas: {
    url: string;
    metodo: string;
    cabecalhos: Record<string, string>;
    corpo: unknown;
    timeout: number;
  }[] = [];
  let i = 0;

  const criar = () => {
    const cabecalhos: Record<string, string> = {};
    const self: Record<string, unknown> = {
      upload: {} as Record<string, unknown>,
      timeout: 0,
      status: 0,
      responseText: '',
      open(metodo: string, url: string) {
        self.__metodo = metodo;
        self.__url = url;
      },
      setRequestHeader(k: string, v: string) {
        cabecalhos[k] = v;
      },
      send(corpo: unknown) {
        const passo = roteiro[Math.min(i, roteiro.length - 1)]!;
        i += 1;
        chamadas.push({
          url: String(self.__url),
          metodo: String(self.__metodo),
          cabecalhos,
          corpo,
          timeout: Number(self.timeout),
        });
        // Progresso antes do fim, como o XHR real faz.
        const up = self.upload as { onprogress?: (e: ProgressEvent) => void };
        up.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
        setImmediate(() => {
          if (passo.tipo === 'responder') {
            self.status = passo.status;
            self.responseText = passo.corpo ?? '';
            (self.onload as () => void)?.();
          } else if (passo.tipo === 'timeout') {
            (self.ontimeout as () => void)?.();
          } else {
            (self.onerror as () => void)?.();
          }
        });
      },
    };
    return self as unknown as XMLHttpRequest;
  };

  return { criar, chamadas };
}

/**
 * FormData no comportamento do React Native: guarda a parte que nao e Blob como ela veio.
 *
 * O FormData do ambiente de teste faz `String(value)` e transforma `{ uri, name, type }` em
 * `"[object Object]"` — o arquivo desaparece sem erro. Como e exatamente essa divergencia
 * entre implementacoes que causou o bug, o teste usa a semantica do aparelho.
 */
class FormDataDoReactNative {
  readonly _parts: [string, unknown][] = [];
  append(name: string, value: unknown) {
    this._parts.push([name, value]);
  }
}

function partesDe(corpo: unknown): [string, unknown][] {
  const f = corpo as { _parts?: [string, unknown][] };
  if (!Array.isArray(f?._parts)) throw new Error('corpo nao e o FormData esperado');
  return f._parts;
}

const ARQUIVO: ArquivoLocal = {
  uri: 'file:///data/user/0/br.com.opendriver.ads/cache/ImagePicker/abc.jpg',
  name: '118314.jpg',
  type: 'image/jpeg',
};

function montar(roteiro: Comportamento[], opts?: { refresh?: () => Promise<RefreshOutcome> }) {
  const { storage, atual } = armazenamentoFalso({ access: 'token-a', refresh: 'r1' });
  const xhr = xhrFalso(roteiro);
  const enviador = createUploader({
    baseUrl: 'https://ads.teste/api/v1',
    storage,
    refreshDelegate: opts?.refresh ?? (async () => 'refreshed'),
    timeoutMs: 180_000,
    xhrImpl: xhr.criar,
    formDataImpl: () => new FormDataDoReactNative() as unknown as FormData,
  });
  return { enviador, xhr, atual, storage };
}

describe('enviador de arquivo por XHR', () => {
  it('manda a parte na forma do React Native, no campo file', async () => {
    const { enviador, xhr } = montar([{ tipo: 'responder', status: 204 }]);

    await expect(
      enviador.enviarArquivo('/advertiser/campaigns/c1/media/s1/bytes', 'file', ARQUIVO)
    ).resolves.toBeUndefined();

    expect(xhr.chamadas).toHaveLength(1);
    const c = xhr.chamadas[0]!;
    expect(c.metodo).toBe('POST');
    expect(c.url).toBe('https://ads.teste/api/v1/advertiser/campaigns/c1/media/s1/bytes');
    expect(c.timeout).toBe(180_000);

    // A parte tem de chegar como `{ uri, name, type }` — e nao como Blob nem como string.
    const [campo, valor] = partesDe(c.corpo)[0]!;
    expect(campo).toBe('file');
    expect(valor).toEqual({ uri: ARQUIVO.uri, name: '118314.jpg', type: 'image/jpeg' });
    expect(valor).not.toBeInstanceOf(Blob);
  });

  it('NAO define Content-Type: o boundary e escrito pelo lado nativo', async () => {
    const { enviador, xhr } = montar([{ tipo: 'responder', status: 204 }]);
    await enviador.enviarArquivo('/x', 'file', ARQUIVO);

    const cab = xhr.chamadas[0]!.cabecalhos;
    expect(Object.keys(cab).map((k) => k.toLowerCase())).not.toContain('content-type');
    expect(cab.Authorization).toBe('Bearer token-a');
    expect(cab.Accept).toBe('application/json');
  });

  it('informa progresso de envio', async () => {
    const { enviador } = montar([{ tipo: 'responder', status: 204 }]);
    const vistos: number[] = [];
    await enviador.enviarArquivo('/x', 'file', ARQUIVO, (f) => vistos.push(f));
    expect(vistos).toContain(0.5);
  });

  it('renova a sessao em 401 e repete uma vez', async () => {
    const refresh = jest.fn<Promise<RefreshOutcome>, []>().mockResolvedValue('refreshed');
    const { enviador, xhr } = montar(
      [
        { tipo: 'responder', status: 401, corpo: '{"error":"expirado"}' },
        { tipo: 'responder', status: 204 },
      ],
      { refresh }
    );

    await expect(enviador.enviarArquivo('/x', 'file', ARQUIVO)).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(xhr.chamadas).toHaveLength(2);
  });

  it('expira a sessao quando a renovacao e recusada', async () => {
    const refresh = jest.fn<Promise<RefreshOutcome>, []>().mockResolvedValue('invalid');
    const aoExpirar = jest.fn();
    const { storage } = armazenamentoFalso({ access: 'velho', refresh: 'r1' });
    const xhr = xhrFalso([{ tipo: 'responder', status: 401 }]);
    const enviador = createUploader({
      baseUrl: 'https://ads.teste/api/v1',
      storage,
      refreshDelegate: refresh,
      onSessionExpired: aoExpirar,
      timeoutMs: 1000,
      xhrImpl: xhr.criar,
      formDataImpl: () => new FormDataDoReactNative() as unknown as FormData,
    });

    await expect(enviador.enviarArquivo('/x', 'file', ARQUIVO)).rejects.toMatchObject({
      status: 401,
    });
    expect(aoExpirar).toHaveBeenCalledTimes(1);
  });

  it('traduz erro de transporte em falha de rede, com a causa preservada', async () => {
    const { enviador } = montar([{ tipo: 'erro' }]);
    await expect(enviador.enviarArquivo('/x', 'file', ARQUIVO)).rejects.toMatchObject({
      kind: 'network',
      status: 0,
      detail: expect.stringContaining('FalhaDeTransporte'),
    });
  });

  it('timeout de envio tem mensagem propria, e nao vira falha de rede', async () => {
    const { enviador } = montar([{ tipo: 'timeout' }]);
    await expect(enviador.enviarArquivo('/x', 'file', ARQUIVO)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('normaliza erro da API em corpo de resposta', async () => {
    const { enviador } = montar([
      {
        tipo: 'responder',
        status: 400,
        corpo: '{"error":{"code":"OBJECT_TOO_LARGE","message":"passou do limite"}}',
      },
    ]);
    await expect(enviador.enviarArquivo('/x', 'file', ARQUIVO)).rejects.toMatchObject({
      status: 400,
      code: 'OBJECT_TOO_LARGE',
      message: 'passou do limite',
    });
  });
});
