export interface PlatformConfig {
  dashboard: {
    /**
     * Optional. When set, the Dashboard “Media Storage” card shows a % bar.
     * Null/undefined means "unset".
     */
    mediaStorageQuotaBytes: number | null;
  };
  mediaLimits: {
    maxVideoBytes: number;
    maxDurationSeconds: number;
    maxWidth: number;
    maxHeight: number;
  };
  fleetHealth: {
    minBatteryPercent: number;
    maxStoragePercent: number;
    gpsHdopMax: number;
    heartbeatFlaggedThresholdMs: number;
  };
  analytics: {
    maxVelocityKmh: number;
    enabled: boolean;
    playBatchMaxBytes: number;
    reconFullPlayMinRatio: number;
    reconMinDurationSec: number;
    fraudBlackoutMaxLux: number;
    fraudHeartbeatIntervalSec: number;
    fraudHeartbeatMinRatio: number;
  };
  monetization: {
    /**
     * Piso de repasse ao motorista, como fracao do valor faturavel da veiculacao.
     *
     * O parceiro define quanto o motorista recebe. Sem piso, o equilibrio natural e todo
     * parceiro definir zero. Campanha abaixo do piso e recusada na criacao, nao na
     * moderacao: erro de validacao e mais barato que fila humana.
     */
    driverPayoutMinPercent: number;

    /**
     * Peso do repasse no leilao de inventario (`k` em
     * `boost = 1 + k * (ofertado / piso - 1)`).
     *
     * Sem peso, o piso vira custo fixo e ninguem paga acima do minimo. Com `k = 0` o
     * leilao desliga e so o piso vale — e a saida segura se o comportamento em producao
     * surpreender, sem exigir deploy.
     */
    driverPayoutAuctionWeight: number;

    /**
     * Quando o repasse ao motorista e liquidado.
     *
     * A receita de in-app purchase nao chega na hora: Apple e Google repassam ao redor de
     * 30 a 45 dias apos o fechamento do mes, ja descontada a comissao. O motorista veicula
     * hoje e a plataforma so tem o dinheiro depois.
     *
     * - `store_cycle` (padrao): `ad_payouts` liquida junto com o repasse da loja. Sem risco
     *   de caixa, e a defasagem e explicada no app do motorista.
     * - `advance`: a plataforma antecipa e financia o capital de giro. Melhor para retencao
     *   do motorista, exige caixa.
     *
     * Padrao conservador de proposito: ligar a antecipacao e decisao financeira, e deve ser
     * um clique no painel, nao um deploy.
     */
    driverPayoutSettlement: 'store_cycle' | 'advance';

    /**
     * Defasagem considerada no ciclo da loja, em dias. Informativa — alimenta a data
     * prevista mostrada ao motorista e o fechamento de `ad_payouts`.
     */
    storeCycleSettlementDays: number;
  };
}

/** GET /api/v1/platform-config */
export interface PlatformConfigGetResponse {
  active: PlatformConfig;
  defaults: PlatformConfig;
  version: number;
}

/** PUT /api/v1/platform-config */
export interface PlatformConfigPutRequest {
  version: number;
  config: PlatformConfig;
}

/** PUT /api/v1/platform-config/restore-defaults */
export interface PlatformConfigRestoreDefaultsRequest {
  version: number;
}

