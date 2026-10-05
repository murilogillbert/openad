import { ads, adsUpload, hub } from './client';
import type { ArquivoLocal } from './upload';
import type {
  Campanha,
  NovaCampanha,
  PaginaDeCampanhas,
  RelatorioDaCampanha,
  RespostaDeAutenticacao,
  ResultadoDeAdesao,
  SessaoDeUpload,
  SituacaoDeAdesao,
  UsuarioDoEcossistema,
  Zona,
} from './types';

/**
 * Único lugar do app que conhece caminho de rota.
 *
 * Nenhuma tela monta string de URL: quando a API muda um caminho, muda aqui e o TypeScript
 * aponta os chamadores.
 */

// --------------------------------------------------------------------------- conta (no hub)

export const conta = {
  entrar: (email: string, password: string) =>
    hub.postPublic<RespostaDeAutenticacao>('/auth/login', { email, password }),

  cadastrar: (dados: { name: string; email: string; password: string; phone?: string }) =>
    hub.postPublic<RespostaDeAutenticacao>('/auth/register', dados),

  esqueciSenha: (email: string) =>
    hub.postPublic<{ message: string }>('/auth/forgot-password', { email }),

  eu: () => hub.get<UsuarioDoEcossistema>('/auth/me'),
};

// ---------------------------------------------------------------- anunciante (no openad)

export const adesao = {
  /** Diz se esta conta do ecossistema já é anunciante. Não cria nada. */
  situacao: (signal?: AbortSignal) => ads.get<SituacaoDeAdesao>('/advertiser/onboarding', signal),

  /** Idempotente: repetir devolve o vínculo existente com `criado: false`. */
  aderir: (legalName?: string) =>
    ads.post<ResultadoDeAdesao>('/advertiser/onboarding', legalName ? { legalName } : {}),
};

export const campanhas = {
  listar: (page = 1, limit = 20, signal?: AbortSignal) =>
    ads.get<PaginaDeCampanhas>(`/advertiser/campaigns?page=${page}&limit=${limit}`, signal),

  obter: (campaignId: string, signal?: AbortSignal) =>
    ads.get<Campanha>(`/advertiser/campaigns/${campaignId}`, signal),

  criar: (dto: NovaCampanha) => ads.post<Campanha>('/advertiser/campaigns', dto),

  /** Entrega para moderação humana. Exige ao menos um criativo aprovado. */
  submeter: (campaignId: string) =>
    ads.post<Campanha>(`/advertiser/campaigns/${campaignId}/submit`, {}),

  estimativa: (campaignId: string, signal?: AbortSignal) =>
    ads.get<Record<string, unknown>>(`/advertiser/campaigns/${campaignId}/estimate`, signal),

  /**
   * Proof-of-play. Sem `from`/`to`, a janela padrão do servidor é o período **contratado** —
   * que é o que o anunciante pagou, e por isso o padrão certo.
   */
  relatorio: (campaignId: string, from?: string, to?: string, signal?: AbortSignal) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const sufixo = q.toString() ? `?${q.toString()}` : '';
    return ads.get<RelatorioDaCampanha>(
      `/advertiser/campaigns/${campaignId}/report${sufixo}`,
      signal
    );
  },
};

export const inventario = {
  /**
   * `GET /advertiser/inventory/zones` responde `{ data: Zona[] }` — envelope **puro**, então
   * o núcleo HTTP já entrega o vetor. Não há `.data` para ler aqui: ler daria `undefined`, e
   * o `?? []` que existia antes transformava isso em "nenhuma zona disponível" sem erro
   * nenhum na tela de nova campanha.
   */
  zonas: (filtros: { city?: string; tier?: string } = {}, signal?: AbortSignal) => {
    const q = new URLSearchParams();
    if (filtros.city) q.set('city', filtros.city);
    if (filtros.tier) q.set('tier', filtros.tier);
    const sufixo = q.toString() ? `?${q.toString()}` : '';
    return ads.get<Zona[]>(`/advertiser/inventory/zones${sufixo}`, signal);
  },
};

/**
 * Upload de criativo em três passos, como a API exige.
 *
 * O servidor não aceita o arquivo numa chamada só de propósito: ele resolve `folderId` e
 * `campaignId` da sessão a partir da campanha que acabou de confirmar ser do solicitante. Se
 * viessem do corpo, um anunciante poderia depositar criativo na pasta de outro.
 *
 * O passo `concluir` é o que roda o `ffprobe` contra o ruleset DOOH e registra no catálogo —
 * é dele que vem a aprovação técnica, e é por isso que ele pode falhar **depois** de os bytes
 * já terem subido. A tela trata isso mostrando o motivo e permitindo trocar o arquivo.
 */
export const criativo = {
  abrirSessao: (campaignId: string, filename: string, contentType: string) =>
    ads.post<{ success: boolean; data: SessaoDeUpload }>(
      `/advertiser/campaigns/${campaignId}/media`,
      { filename, contentType }
    ),

  /**
   * Vai por `XMLHttpRequest` (`adsUpload`), não pelo `fetch`.
   *
   * O `fetch` que o Expo instala rejeita a parte `{ uri, name, type }` do React Native com
   * `Unsupported FormDataPart implementation`, o que fazia **todo** envio de criativo falhar.
   * O campo multipart é `file`, como `FileInterceptor('file', ...)` exige na API.
   */
  enviarBytes: (
    campaignId: string,
    sessionId: string,
    arquivo: ArquivoLocal,
    aoProgresso?: (fracao: number) => void
  ) =>
    adsUpload.enviarArquivo<void>(
      `/advertiser/campaigns/${campaignId}/media/${sessionId}/bytes`,
      'file',
      arquivo,
      aoProgresso
    ),

  concluir: (campaignId: string, sessionId: string) =>
    ads.post<{ success: boolean; data: Record<string, unknown> }>(
      `/advertiser/campaigns/${campaignId}/media/${sessionId}/complete`,
      {}
    ),
};
