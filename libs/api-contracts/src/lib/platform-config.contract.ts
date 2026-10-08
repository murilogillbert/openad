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
     * Preco por segundo de tela, em **micro-reais** (1 R$ = 1.000.000 µR$).
     *
     * O preco acordado e R$ 0,003 por segundo, que e 0,3 centavo — nao cabe em centavo
     * inteiro. Uma imagem de 15 s custa 4,5 centavos, um video de 10 s custa 3 centavos. Em
     * centavos, 4,5 arredondaria, e arredondar por veiculacao perderia 0,5 centavo de 4,5
     * (11%), sempre contra o mesmo lado, multiplicado por milhoes de veiculacoes.
     *
     * Micro-real e inteiro, entao nao ha fracao escondida: R$ 0,003/s = 3.000 µR$/s. A
     * conversao para centavos acontece so na fronteira do lancamento, com o resto carregado
     * para o lancamento seguinte, para o vies nunca acumular.
     */
    pricePerSecondMicros: number;

    /**
     * Segundos cobrados por uma imagem estatica.
     *
     * O anunciante nao escolhe: imagem e sempre este valor. Vem daqui e nao do `duration`
     * gravado no asset, que vale 10 nas imagens enviadas antes desta regra — usar o asset
     * cobraria 10 s de uma imagem que fica 15 s na tela.
     */
    imageDisplaySeconds: number;

    /**
     * Teto de repasse ao motorista, como fracao do valor faturavel.
     *
     * Existe pelo mesmo motivo que o piso, do outro lado: sem teto, `percent` aceita
     * qualquer valor ate 100% e a plataforma nao retem nada da veiculacao. Com 0,8, ela
     * retem ao menos 20% de cada exibicao.
     */
    driverPayoutMaxPercent: number;

    /**
     * Duracao do ciclo de credito, em minutos.
     *
     * E o periodo entre duas reservas de credito do anunciante, e casa com o intervalo de
     * sincronizacao do tablet: analise e manifest sao refeitos a cada 15 min, entao a
     * reserva vale por esse mesmo intervalo.
     */
    creditCycleMinutes: number;

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

