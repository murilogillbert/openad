import { ApiError } from './errors';

/**
 * Núcleo HTTP sem dependência de React Native (testável em Node contra a API real).
 *
 * Derivado do cliente do app do OpenDriver, com duas diferenças que existem porque este app
 * fala com **dois** serviços:
 *
 * 1. `refreshDelegate`. O token é emitido e renovado pelo **hub**; o openad apenas o valida.
 *    O cliente do openad não pode chamar `/auth/refresh` no próprio `baseUrl` — aquela rota
 *    existe lá, mas valida refresh token de usuário interno do openad, não do hub. Então o
 *    cliente do openad delega a renovação ao cliente do hub, e os dois compartilham o mesmo
 *    `TokenStorage`.
 * 2. Normalização de dois formatos de erro. O hub devolve `{ error: "texto", code: "..." }` e
 *    o openad devolve `{ error: { code, message } }`. Sem normalizar, metade das telas
 *    mostraria "[object Object]" — e seria descoberto em produção, porque o caminho de erro é
 *    o menos exercitado em desenvolvimento.
 *
 * Mantido do original, porque resolve problemas reais:
 *  - envelope `{ data }` desembrulhado automaticamente;
 *  - refresh single-flight: N requisições com 401 simultâneo disparam UM refresh (a rota de
 *    refresh do hub tem rate limit por IP);
 *  - `sessionGeneration`: um refresh iniciado numa sessão antiga não ressuscita um logout.
 */

export interface TokenPair {
  token: string;
  refreshToken: string;
}

export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

export type RefreshOutcome = 'refreshed' | 'invalid';

export interface HttpClientOptions<TRefreshUser = unknown> {
  baseUrl: string;
  storage: TokenStorage;
  fetchImpl?: typeof fetch;
  /** Timeout padrão por requisição (ms). */
  timeoutMs?: number;
  /** Chamado quando a sessão fica inválida (refresh recusado) — força logout na UI. */
  onSessionExpired?: () => void;
  /** Chamado após um refresh bem-sucedido, com o usuário atualizado devolvido pela API. */
  onTokensRefreshed?: (user: TRefreshUser) => void;
  /**
   * Quem renova o token. Ausente = este cliente renova sozinho em `POST /auth/refresh` do
   * próprio `baseUrl` (é o caso do cliente do hub).
   *
   * Presente = delega (é o caso do cliente do openad, que delega ao do hub). Delegar em vez de
   * duplicar é o que garante que os dois clientes nunca disputem o mesmo refresh token: só um
   * sabe renovar.
   */
  refreshDelegate?: () => Promise<RefreshOutcome>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** false = rota pública: não envia Authorization nem tenta refresh. */
  auth?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** Upload de criativo é vídeo: o teto padrão de 20 s não serve. */
export const UPLOAD_TIMEOUT_MS = 180_000;

function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

/**
 * Desembrulha **apenas** o envelope puro `{ data }` — objeto cuja única chave é `data`.
 *
 * O hub sempre responde `{ data: <payload> }` e nada mais (conferido de fora em
 * `/auth/login` e `/auth/me`). O openad responde o payload direto na maioria das rotas, mas
 * em três delas `data` é um **campo do payload**, com irmãos:
 *
 *   GET  /advertiser/campaigns             -> { data, pagination }
 *   POST /advertiser/campaigns/:id/media   -> { success, data }
 *   POST .../media/:sessionId/complete     -> { success, data }
 *
 * A regra anterior era "se existe `data`, desembrulhe", e ela engolia o `pagination` da lista
 * de campanhas: a tela recebia o vetor cru, `pagina.data` virava `undefined` e
 * `pagina.data.length` lançava TypeError — o app caía no ErrorBoundary em **toda** abertura
 * da tela inicial. Exigir que `data` seja a única chave distingue envelope de payload sem
 * adivinhar pelo nome do campo.
 *
 * Vetor no topo nunca é envelope, e `Object.keys` de vetor não devolve `data`, então o
 * caminho é o mesmo: passa direto.
 */
function desembrulhar<T>(json: unknown): T {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return json as T;
  const chaves = Object.keys(json);
  if (chaves.length === 1 && chaves[0] === 'data') return (json as { data: T }).data;
  return json as T;
}

/**
 * Extrai mensagem e código de erro dos dois formatos do ecossistema.
 *
 * hub:    `{ "error": "Credenciais invalidas.", "code": "unauthenticated" }`
 * openad: `{ "error": { "code": "CAMPAIGN_NOT_FOUND", "message": "..." } }`
 */
export function normalizarErro(
  json: unknown,
  status: number
): { message: string; code?: string } {
  const corpo = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const erro = corpo.error;

  if (typeof erro === 'string' && erro.trim()) {
    const code = typeof corpo.code === 'string' ? corpo.code : undefined;
    return { message: erro, code };
  }

  if (erro && typeof erro === 'object') {
    const e = erro as Record<string, unknown>;
    const message = typeof e.message === 'string' && e.message.trim() ? e.message : undefined;
    const code = typeof e.code === 'string' ? e.code : undefined;
    if (message) return { message, code };
    if (code) return { message: generica(status), code };
  }

  // `class-validator` do NestJS, quando a validação falha antes do filtro de exceção.
  if (Array.isArray(corpo.message) && typeof corpo.message[0] === 'string') {
    return { message: corpo.message.join('. ') };
  }
  if (typeof corpo.message === 'string' && corpo.message.trim()) {
    return { message: corpo.message };
  }

  return { message: generica(status) };
}

/** Nunca mostra código técnico ao usuário: sem mensagem da API, texto genérico. */
function generica(status: number): string {
  return status >= 500
    ? 'Algo deu errado do nosso lado. Tente novamente em instantes.'
    : 'Não foi possível concluir. Tente novamente.';
}

export function createHttpClient<TRefreshUser = unknown>(options: HttpClientOptions<TRefreshUser>) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const storage = options.storage;

  let sessionGeneration = 0;
  let refreshInFlight: Promise<RefreshOutcome> | null = null;

  async function send(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    external?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', onExternalAbort);
    }
    try {
      return await fetchImpl(`${baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (falha) {
      /**
       * A causa é propagada, e não descartada.
       *
       * Antes era `catch {}` sem binding: DNS, TLS, conexão cortada no meio do envio e corpo
       * que o runtime não conseguiu montar a partir do arquivo viravam todos a mesma frase,
       * sem nada que os separasse no aparelho. Num envio de criativo que falha sempre, isso é
       * a diferença entre diagnosticar e adivinhar.
       */
      if (timedOut) {
        throw new ApiError(
          'O servidor demorou para responder. Tente novamente.',
          0,
          'timeout',
          undefined,
          falha
        );
      }
      if (external?.aborted) {
        throw new ApiError('Requisição cancelada.', 0, 'aborted', undefined, falha);
      }
      // Vai para o logcat (`adb logcat -s ReactNativeJS`) junto com rota e método.
      console.error('Falha de rede antes da resposta', {
        url: `${baseUrl}${path}`,
        metodo: init.method,
        causa: falha instanceof Error ? `${falha.name}: ${falha.message}` : String(falha),
      });
      throw new ApiError(
        'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
        0,
        'network',
        undefined,
        falha
      );
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const { message, code } = normalizarErro(json, res.status);
      throw new ApiError(message, res.status, 'http', code);
    }
    if (json === null) {
      if (!text) return undefined as T;
      throw new ApiError('Resposta inválida do servidor.', res.status, 'invalid_response');
    }
    return desembrulhar<T>(json);
  }

  async function expireSession(): Promise<void> {
    sessionGeneration++;
    await storage.clear();
    options.onSessionExpired?.();
  }

  function refreshTokens(): Promise<RefreshOutcome> {
    if (options.refreshDelegate) return options.refreshDelegate();
    if (refreshInFlight) return refreshInFlight;
    const generation = sessionGeneration;
    refreshInFlight = (async (): Promise<RefreshOutcome> => {
      const refreshToken = await storage.getRefreshToken();
      if (!refreshToken) return 'invalid';
      const res = await send(
        '/auth/refresh',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refreshToken }),
        },
        DEFAULT_TIMEOUT_MS
      );
      // 400/401: refresh expirado, adulterado ou usuário removido → a sessão morreu.
      // 429/5xx: problema transitório — **não** desloga, propaga o erro. Deslogar num 429
      // transformaria um pico de tráfego em logout de toda a base.
      if (res.status === 400 || res.status === 401) return 'invalid';
      const data = await parse<TokenPair & { user: TRefreshUser }>(res);
      if (!data?.token || !data?.refreshToken) {
        throw new ApiError('Resposta inválida do servidor.', res.status, 'invalid_response');
      }
      if (generation !== sessionGeneration) return 'refreshed';
      await storage.setTokens({ token: data.token, refreshToken: data.refreshToken });
      options.onTokensRefreshed?.(data.user);
      return 'refreshed';
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function request<T>(
    path: string,
    opts: RequestOptions = {},
    allowRefresh = true
  ): Promise<T> {
    const auth = opts.auth !== false;
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      /**
       * Multipart **não** passa por aqui, e a recusa é explícita de propósito.
       *
       * O `fetch` que o Expo instala no lugar do global só aceita partes `string`, `Blob` ou
       * objeto com `bytes()`; a forma `{ uri, name, type }` do React Native lança
       * `Unsupported FormDataPart implementation` lá dentro, e esta camada traduzia aquilo
       * para "Sem conexão com o servidor" — uma falha determinística disfarçada de problema
       * de internet, que custou horas para ser localizada. Falhar aqui, com o caminho da
       * alternativa no texto, evita a repetição.
       */
      if (isFormData(opts.body)) {
        throw new ApiError(
          'Envio de arquivo não vai pelo fetch: use o enviador de `api/upload.ts` (`adsUpload`).',
          0,
          'invalid_response'
        );
      }
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const generation = sessionGeneration;
    if (auth) {
      const token = await storage.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await send(
      path,
      { method: opts.method ?? 'GET', headers, body },
      opts.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      opts.signal
    );

    if (res.status === 401 && auth) {
      // Login ou logout aconteceu enquanto esta requisição voava: repete com a sessão atual.
      if (generation !== sessionGeneration && allowRefresh) return request<T>(path, opts, false);
      if (allowRefresh) {
        const outcome = await refreshTokens();
        if (outcome === 'refreshed') return request<T>(path, opts, false);
      }
      await expireSession();
      throw new ApiError('Sua sessão expirou. Entre novamente.', 401, 'http');
    }

    return parse<T>(res);
  }

  return {
    request,
    refreshTokens,
    get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    postPublic: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body, auth: false }),
    getPublic: <T>(path: string, signal?: AbortSignal) =>
      request<T>(path, { method: 'GET', auth: false, signal }),

    /** Grava os tokens de um login ou cadastro — invalida refresh de sessões anteriores. */
    async startSession(tokens: TokenPair): Promise<void> {
      sessionGeneration++;
      await storage.setTokens(tokens);
    },
    async endSession(): Promise<void> {
      sessionGeneration++;
      await storage.clear();
    },
    hasSession: async () =>
      (await storage.getAccessToken()) !== null || (await storage.getRefreshToken()) !== null,
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
