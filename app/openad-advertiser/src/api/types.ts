/**
 * Tipos de resposta das duas APIs.
 *
 * Espelham o que o servidor devolve de fato — conferidos contra
 * `hub/backend/src/services/authService.ts` e
 * `openad/app/openad-api/src/modules/advertiser/*`. Dinheiro é **sempre centavos inteiros**
 * nos campos com sufixo `Cents`: o openad conta dinheiro em inteiro de ponta a ponta, e o
 * sufixo no nome é o que impede o erro de fator 100 passar numa revisão.
 */

// ----------------------------------------------------------------------------- hub (conta)

export interface UsuarioDoEcossistema {
  id: string;
  name: string;
  email: string;
  role: string;
  phone?: string | null;
  avatarUrl?: string | null;
}

export interface RespostaDeAutenticacao {
  token: string;
  refreshToken: string;
  user: UsuarioDoEcossistema;
}

// ------------------------------------------------------------------------ openad (anunciante)

export interface SituacaoDeAdesao {
  conta: { userId: string; email: string; name: string };
  anunciante: {
    advertiserId: string;
    legalName: string;
    status: string;
    createdAt: string;
  } | null;
  precisaAderir: boolean;
}

export interface ResultadoDeAdesao {
  criado: boolean;
  anunciante: NonNullable<SituacaoDeAdesao['anunciante']>;
}

/**
 * Saldo de crédito de veiculação, em três números que respondem perguntas diferentes.
 *
 * `disponivel` é o que pode ser reservado agora — é ele que decide se a campanha vai ao ar no
 * próximo ciclo. `retido` é o que já está comprometido com campanha no ar. Mostrar só o total
 * levaria o anunciante a concluir que há crédito livre que não há.
 *
 * Os campos sem sufixo vêm em **reais** (o servidor já converteu); os com `Micros` são
 * micro-reais exatos, porque o consumo é de R$ 0,003 por segundo e centavo não cabe.
 */
export interface SaldoDeCredito {
  totalMicros: number;
  retidoMicros: number;
  disponivelMicros: number;
  total: number;
  retido: number;
  disponivel: number;
  currency: string;
}

/** Estados possíveis de uma campanha. Espelha `campaign-status.policy.ts` da API. */
export type StatusDeCampanha =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'active'
  | 'paused'
  | 'completed'
  | 'rejected'
  | 'archived';

export interface Campanha {
  campaignId: string;
  name: string;
  status: StatusDeCampanha;
  priority: number;
  budget: {
    totalAmountCents: number;
    currency: string;
    ratePerImpressionCents: number;
    dailyBudgetCents: number | null;
  };
  driverPayout: {
    model: 'percent' | 'per_play';
    percent: number | null;
    valueCents: number | null;
  } | null;
  targeting: {
    cities: string[];
    zoneIds: string[];
    tiers: string[];
    vehicleTiers: string[];
    dayparts: string[];
  };
  moderation: {
    decision: 'approved' | 'rejected';
    reviewedAt: string;
    reason: string | null;
  } | null;
  creativeCount: number;
  scheduledStart: string;
  scheduledEnd: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PaginaDeCampanhas {
  data: Campanha[];
  pagination: { total: number; page: number; limit: number };
}

export interface NovaCampanha {
  name: string;
  priority: number;
  scheduledStart: string;
  scheduledEnd: string;
  budget: {
    totalAmountCents: number;
    ratePerImpressionCents: number;
    currency: string;
  };
  targeting?: {
    cities?: string[];
    zoneIds?: string[];
    tiers?: string[];
    vehicleTiers?: string[];
    dayparts?: string[];
  };
  driverPayout?: {
    model: 'percent' | 'per_play';
    percent?: number;
    valueCents?: number;
  };
}

export interface Zona {
  zoneId: string;
  name: string;
  city: string;
  tier: string;
  vehicleCount?: number;
}

/** Sessão de upload de criativo, aberta por `POST /advertiser/campaigns/:id/media`. */
export interface SessaoDeUpload {
  sessionId: string;
  /** Alguns servidores devolvem campos extra; só `sessionId` é usado pelo app. */
  [extra: string]: unknown;
}

/**
 * Proof-of-play da campanha. Espelha `CampaignReportingSummary` da API.
 *
 * `impressions` conta **veiculações faturáveis** — já reconciliadas por duração e com
 * antifraude aplicada, não o que o equipamento reportou. `reach` é a quantidade de veículos
 * distintos que exibiram ao menos uma vez.
 */
export interface RelatorioDaCampanha {
  campaignId: string;
  window: { from: string; to: string };
  impressions: number;
  reach: number;
  revenueTotalCents: number;
  currency: string;
  revenueLines: { label: string; plays: number; amountCents: number }[];
}
