import { env } from '@/config/env';
import { createHttpClient, type RefreshOutcome } from './http';
import { createSecureTokenStorage } from './secureTokenStorage';
import type { UsuarioDoEcossistema } from './types';

/**
 * Os dois clientes do app, sobre **um** armazenamento de tokens.
 *
 * `hub` fala com a API do hub e é o **único** que sabe renovar o token: é o hub que emite.
 * `ads` fala com a API do openad e delega a renovação ao `hub`.
 *
 * Por que não um cliente só com caminho absoluto: as duas APIs têm formatos de erro
 * diferentes, timeouts diferentes (upload de vídeo contra login) e, principalmente, origens
 * diferentes para o refresh. Um cliente só obrigaria um `if` por origem dentro do núcleo HTTP,
 * que é o lugar onde menos se quer condicional.
 *
 * Por que um armazenamento só: é a **mesma** sessão. Dois armazenamentos permitiriam o estado
 * impossível de estar logado no hub e deslogado no openad, e a tela não teria como decidir
 * qual dos dois é a verdade.
 */

export const tokenStorage = createSecureTokenStorage();

type AoExpirar = () => void;
type AoRenovar = (user: UsuarioDoEcossistema) => void;

let aoExpirar: AoExpirar | null = null;
let aoRenovar: AoRenovar | null = null;

/**
 * O `AuthContext` registra os avisos depois da criação dos clientes.
 *
 * A indireção existe porque os clientes são criados no carregamento do módulo (para que
 * qualquer tela possa importá-los) e o contexto só existe depois da montagem do React. Passar
 * os callbacks no construtor exigiria criar os clientes dentro do componente, e aí cada
 * remontagem criaria um par novo — com o estado de `sessionGeneration` zerado, perdendo a
 * proteção contra refresh de sessão antiga.
 */
export function registrarAvisosDeSessao(opts: { aoExpirar: AoExpirar; aoRenovar: AoRenovar }) {
  aoExpirar = opts.aoExpirar;
  aoRenovar = opts.aoRenovar;
}

export const hub = createHttpClient<UsuarioDoEcossistema>({
  baseUrl: env.hubBaseUrl,
  storage: tokenStorage,
  onSessionExpired: () => aoExpirar?.(),
  onTokensRefreshed: (user) => aoRenovar?.(user),
});

export const ads = createHttpClient({
  baseUrl: env.adsBaseUrl,
  storage: tokenStorage,
  onSessionExpired: () => aoExpirar?.(),
  /**
   * Delegação explícita: um 401 vindo do openad manda renovar **no hub**.
   *
   * Sem isto, o cliente do openad chamaria `POST /api/v1/auth/refresh` no openad — rota que
   * existe, responde 200 para usuário interno e **401 para refresh token do hub**. O resultado
   * seria logout a cada expiração de token (a cada 2 h), com a sessão do hub perfeitamente
   * válida.
   */
  refreshDelegate: (): Promise<RefreshOutcome> => hub.refreshTokens(),
});

/** Encerra a sessão nos dois clientes. Chamado pelo logout e pela expiração. */
export async function encerrarSessao(): Promise<void> {
  await hub.endSession();
  await ads.endSession();
}

/** Inicia a sessão. Grava uma vez; os dois clientes leem do mesmo armazenamento. */
export async function iniciarSessao(tokens: {
  token: string;
  refreshToken: string;
}): Promise<void> {
  await hub.startSession(tokens);
  // `ads.startSession` não regrava os tokens (são os mesmos): serve para incrementar o
  // `sessionGeneration` daquele cliente, para que uma requisição em voo de antes do login não
  // seja tratada como pertencente à sessão nova.
  await ads.startSession(tokens);
}
