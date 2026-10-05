import { createHttpClient, normalizarErro, type TokenStorage } from '@/api/http';

/**
 * O nucleo HTTP e onde moram as duas decisoes que distinguem este app: delegacao de refresh
 * entre dois servicos, e normalizacao de dois formatos de erro.
 *
 * Testado contra `fetch` simulado, sem React Native: o comportamento sob 401 e o que decide se
 * o anunciante fica logado ou e expulso para a tela de senha, e nao e algo para descobrir em
 * produçao.
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
  return {
    storage,
    atual: () => ({ access, refresh }),
  };
}

function resposta(status: number, corpo: unknown, ok?: boolean): Response {
  const texto = corpo === undefined ? '' : JSON.stringify(corpo);
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    text: async () => texto,
  } as unknown as Response;
}

describe('normalizarErro', () => {
  it('entende o formato do hub: error como texto', () => {
    expect(normalizarErro({ error: 'Credenciais invalidas.', code: 'unauthenticated' }, 401)).toEqual(
      { message: 'Credenciais invalidas.', code: 'unauthenticated' }
    );
  });

  it('entende o formato do openad: error como objeto', () => {
    expect(
      normalizarErro({ error: { code: 'CAMPAIGN_NOT_FOUND', message: 'nao achei' } }, 404)
    ).toEqual({ message: 'nao achei', code: 'CAMPAIGN_NOT_FOUND' });
  });

  it('junta a lista de mensagens do class-validator', () => {
    const r = normalizarErro(
      { message: ['name should not be empty', 'priority must be an integer'], statusCode: 400 },
      400
    );
    expect(r.message).toContain('name should not be empty');
    expect(r.message).toContain('priority must be an integer');
  });

  it('cai em texto generico sem expor codigo tecnico', () => {
    expect(normalizarErro(null, 500).message).toMatch(/nosso lado/i);
    expect(normalizarErro(null, 400).message).toMatch(/nao foi possivel|não foi possível/i);
    expect(normalizarErro({ error: {} }, 418).message).toBeTruthy();
  });

  it('nunca devolve objeto como mensagem', () => {
    for (const corpo of [{ error: {} }, { error: [] }, { error: 123 }, {}, null, 'texto']) {
      expect(typeof normalizarErro(corpo, 400).message).toBe('string');
    }
  });
});

describe('createHttpClient', () => {
  it('desembrulha o envelope { data }', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const fetchImpl = jest.fn().mockResolvedValue(resposta(200, { data: { x: 1 } }));
    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl });

    await expect(c.get('/coisa')).resolves.toEqual({ x: 1 });
  });

  it('devolve o corpo cru quando nao ha envelope', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const fetchImpl = jest.fn().mockResolvedValue(resposta(200, { x: 1 }));
    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl });

    await expect(c.get('/coisa')).resolves.toEqual({ x: 1 });
  });

  /**
   * As tres formas abaixo sao as que o openad devolve de fato, conferidas contra
   * `advertiser.controller.ts`. Antes desta correcao o cliente desembrulhava qualquer corpo
   * que tivesse `data`, e o primeiro caso derrubava a tela inicial do app: a lista chegava
   * como vetor cru, `pagina.data` ficava `undefined` e `pagina.data.length` lancava.
   */
  it('NAO desembrulha quando data tem irmao: { data, pagination }', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const corpo = { data: [{ campaignId: 'c1' }], pagination: { total: 1, page: 1, limit: 20 } };
    const fetchImpl = jest.fn().mockResolvedValue(resposta(200, corpo));
    const c = createHttpClient({ baseUrl: 'https://ads.teste', storage, fetchImpl });

    await expect(c.get('/advertiser/campaigns')).resolves.toEqual(corpo);
  });

  it('NAO desembrulha quando data tem irmao: { success, data }', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const corpo = { success: true, data: { sessionId: 's1', maxBytes: 100 } };
    const fetchImpl = jest.fn().mockResolvedValue(resposta(200, corpo));
    const c = createHttpClient({ baseUrl: 'https://ads.teste', storage, fetchImpl });

    await expect(c.post('/advertiser/campaigns/c1/media')).resolves.toEqual(corpo);
  });

  it('desembrulha o envelope puro { data } com vetor dentro', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const fetchImpl = jest.fn().mockResolvedValue(resposta(200, { data: [{ zoneId: 'z1' }] }));
    const c = createHttpClient({ baseUrl: 'https://ads.teste', storage, fetchImpl });

    await expect(c.get('/advertiser/inventory/zones')).resolves.toEqual([{ zoneId: 'z1' }]);
  });

  it('vetor no topo passa direto, sem ser confundido com envelope', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const fetchImpl = jest.fn().mockResolvedValue(resposta(200, [1, 2, 3]));
    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl });

    await expect(c.get('/coisa')).resolves.toEqual([1, 2, 3]);
  });

  it('manda Authorization quando ha token, e nao manda em rota publica', async () => {
    const { storage } = armazenamentoFalso({ access: 'token-abc' });
    const fetchImpl = jest.fn().mockResolvedValue(resposta(200, { data: true }));
    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl });

    await c.get('/privado');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer token-abc');

    await c.getPublic('/publico');
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it('renova o token em 401 e repete a requisicao uma vez', async () => {
    const { storage, atual } = armazenamentoFalso({ access: 'velho', refresh: 'r1' });
    const fetchImpl = jest
      .fn()
      // 1) requisicao original -> 401
      .mockResolvedValueOnce(resposta(401, { error: 'expirado' }))
      // 2) refresh -> tokens novos
      .mockResolvedValueOnce(
        resposta(200, { data: { token: 'novo', refreshToken: 'r2', user: { id: 'u1' } } })
      )
      // 3) repeticao -> sucesso
      .mockResolvedValueOnce(resposta(200, { data: { ok: true } }));

    const aoRenovar = jest.fn();
    const c = createHttpClient<{ id: string }>({
      baseUrl: 'https://api.teste',
      storage,
      fetchImpl,
      onTokensRefreshed: aoRenovar,
    });

    await expect(c.get('/privado')).resolves.toEqual({ ok: true });
    expect(atual()).toEqual({ access: 'novo', refresh: 'r2' });
    expect(aoRenovar).toHaveBeenCalledWith({ id: 'u1' });
    // A repeticao usa o token novo, nao o velho.
    expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBe('Bearer novo');
  });

  it('dispara UM refresh para varios 401 simultaneos', async () => {
    // A rota de refresh do hub tem limite por IP: tres 401 ao mesmo tempo virando tres
    // refreshes esgotariam o limite e deslogariam o usuario.
    const { storage } = armazenamentoFalso({ access: 'velho', refresh: 'r1' });
    let refreshes = 0;
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        return resposta(200, { data: { token: 'novo', refreshToken: 'r2', user: {} } });
      }
      return refreshes === 0 ? resposta(401, { error: 'expirado' }) : resposta(200, { data: 'ok' });
    }) as unknown as typeof fetch;

    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl });
    await Promise.all([c.get('/a'), c.get('/b'), c.get('/c')]);

    expect(refreshes).toBe(1);
  });

  it('expira a sessao quando o refresh e recusado', async () => {
    const { storage, atual } = armazenamentoFalso({ access: 'velho', refresh: 'r1' });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(resposta(401, { error: 'expirado' }))
      .mockResolvedValueOnce(resposta(401, { error: 'refresh invalido' }));

    const aoExpirar = jest.fn();
    const c = createHttpClient({
      baseUrl: 'https://api.teste',
      storage,
      fetchImpl,
      onSessionExpired: aoExpirar,
    });

    await expect(c.get('/privado')).rejects.toMatchObject({ status: 401 });
    expect(aoExpirar).toHaveBeenCalledTimes(1);
    expect(atual()).toEqual({ access: null, refresh: null });
  });

  it('NAO desloga quando o refresh devolve 429 ou 5xx', async () => {
    // Deslogar num pico de trafego transformaria indisponibilidade momentanea em logout de
    // toda a base, com a sessao valida.
    const { storage, atual } = armazenamentoFalso({ access: 'velho', refresh: 'r1' });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(resposta(401, { error: 'expirado' }))
      .mockResolvedValueOnce(resposta(429, { error: 'calma' }));

    const aoExpirar = jest.fn();
    const c = createHttpClient({
      baseUrl: 'https://api.teste',
      storage,
      fetchImpl,
      onSessionExpired: aoExpirar,
    });

    await expect(c.get('/privado')).rejects.toBeDefined();
    expect(aoExpirar).not.toHaveBeenCalled();
    expect(atual().refresh).toBe('r1');
  });

  it('delega a renovacao quando refreshDelegate existe', async () => {
    // E o caso do cliente do openad: quem renova e o hub. Sem a delegacao, o cliente do
    // openad chamaria /auth/refresh no openad, que recusa refresh token do hub — e o
    // anunciante seria deslogado a cada expiracao, com a sessao do hub valida.
    const { storage } = armazenamentoFalso({ access: 'velho', refresh: 'r1' });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(resposta(401, { error: 'expirado' }))
      .mockResolvedValueOnce(resposta(200, { data: { ok: true } }));

    const delegado = jest.fn<Promise<'refreshed'>, []>().mockResolvedValue('refreshed');
    const c = createHttpClient({
      baseUrl: 'https://ads.teste',
      storage,
      fetchImpl,
      refreshDelegate: delegado,
    });

    await expect(c.get('/advertiser/campaigns')).resolves.toEqual({ ok: true });
    expect(delegado).toHaveBeenCalledTimes(1);
    // Nenhuma chamada a /auth/refresh na propria base.
    expect(
      (fetchImpl.mock.calls as [string, unknown][]).some(([url]) => url.includes('/auth/refresh'))
    ).toBe(false);
  });

  it('traduz falha de rede em ApiError transitorio', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const fetchImpl = jest.fn().mockRejectedValue(new Error('falhou'));
    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl });

    await expect(c.get('/x')).rejects.toMatchObject({ kind: 'network', status: 0 });
  });

  /**
   * A causa tem de sobreviver: sem ela, "Sem conexao com o servidor" cobre DNS, TLS, conexao
   * cortada e corpo que o runtime nao conseguiu montar, e nao ha como separar os casos a
   * partir do aparelho.
   */
  it('preserva a causa tecnica da falha de rede', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const original = new TypeError('Network request failed');
    const fetchImpl = jest.fn().mockRejectedValue(original);
    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl });

    await expect(c.get('/x')).rejects.toMatchObject({
      kind: 'network',
      detail: 'TypeError: Network request failed',
      cause: original,
    });
  });

  it('inclui a causa aninhada no detalhe, quando houver', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const raiz = new Error('EACCES open content://media/118227');
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(new TypeError('Network request failed', { cause: raiz }));
    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl });

    await expect(c.get('/x')).rejects.toMatchObject({
      detail: 'TypeError: Network request failed (causa: Error: EACCES open content://media/118227)',
    });
  });

  it('timeout tambem carrega a causa, e nao vira falha de rede', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    ) as unknown as typeof fetch;
    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl, timeoutMs: 20 });

    await expect(c.get('/x')).rejects.toMatchObject({ kind: 'timeout', status: 0 });
  });

  it('204 devolve undefined em vez de quebrar no JSON.parse', async () => {
    const { storage } = armazenamentoFalso({ access: 'a' });
    const fetchImpl = jest.fn().mockResolvedValue(resposta(204, undefined));
    const c = createHttpClient({ baseUrl: 'https://api.teste', storage, fetchImpl });

    await expect(c.post('/x')).resolves.toBeUndefined();
  });
});
