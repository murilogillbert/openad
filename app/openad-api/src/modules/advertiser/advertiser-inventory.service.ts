import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { CampaignDocument } from '../campaigns/campaign.schema';
import { GeoZone, GeoZoneDocument } from '../geo-zones/geo-zone.schema';
import {
  MICROS_POR_CENTAVO,
  tabelaDePreco,
  veiculacoesQueOSaldoCobre,
} from '../monetization/pricing.policy';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';
import { Vehicle, VehicleDocument } from '../vehicles/vehicles.schema';

/** Zona oferecida ao anunciante. Sem geometria nem binding: ele compra alcance, nao mapa. */
export interface ZonaDeInventario {
  zoneId: string;
  name: string;
  city: string;
  tier: 'T1' | 'T2' | 'T3' | 'T4';
}

export interface EstimativaDeCampanha {
  campaignId: string;
  /** Zonas ativas que a segmentacao da campanha alcanca. */
  zonesMatched: number;
  /** Cidades distintas entre as zonas alcancadas. */
  citiesMatched: string[];
  /** Veiculos ativos com tablet vinculado, dentro dos tiers segmentados. */
  vehiclesEligible: number;
  /** Teto de veiculacoes faturaveis que o orcamento cobre. */
  maxBillablePlays: number;
  dailyBudgetCents: number;
  /** Teto diario de veiculacoes, derivado do teto diario de gasto. */
  maxDailyBillablePlays: number;
  currency: string;
  /**
   * Campos **aditivos** do preco por segundo. Cliente que nao os conhece ignora.
   *
   * Os campos acima descrevem o modelo antigo (orcamento dividido pela tarifa por
   * veiculacao), que so faz sentido em campanha `per_impression`. Com preco por segundo,
   * exibicoes da mesma campanha custam valores diferentes — imagem de 15 s e video de 60 s
   * nao sao a mesma coisa — e "quantas exibicoes cabem" so faz sentido **por duracao**.
   */
  pricingModel: 'per_impression' | 'per_second';
  /** Preco por segundo gravado na campanha, em micro-reais. Nulo em `per_impression`. */
  pricePerSecondMicros: number | null;
  /** Teto de segundos de tela que o orcamento cobre. */
  maxBillableSeconds: number;
  /** Quantas exibicoes de cada duracao o orcamento cobre. Vazio em `per_impression`. */
  pricingTable: Array<{ seconds: number; costMicros: number; maxPlays: number }>;
  /**
   * Avisos acionaveis. Vazio significa que a campanha tem para onde ir; qualquer item aqui
   * explica por que ela nao veicularia como esta.
   */
  warnings: string[];
}

/** Multiplicadores de custo por tier, espelhando a arbitragem espacial. */
const ZONE_TIERS = ['T1', 'T2', 'T3', 'T4'] as const;

@Injectable()
export class AdvertiserInventoryService {
  constructor(
    @InjectModel(GeoZone.name)
    private readonly zones: Model<GeoZoneDocument>,
    @InjectModel(Vehicle.name)
    private readonly vehicles: Model<VehicleDocument>,
    // O preço por segundo e a duração do ciclo de crédito vêm da configuração da plataforma,
    // com a campanha podendo ter preço próprio gravado.
    private readonly platform: PlatformConfigRuntimeService
  ) {}

  async listarZonas(params: {
    city?: string;
    tier?: string;
  }): Promise<ZonaDeInventario[]> {
    const filtro: Record<string, unknown> = { isActive: true };
    if (params.city) {
      filtro['city'] = params.city;
    }
    if (params.tier && (ZONE_TIERS as readonly string[]).includes(params.tier)) {
      filtro['tier'] = params.tier;
    }
    const rows = await this.zones
      .find(filtro)
      .select({ zoneId: 1, name: 1, city: 1, tier: 1 })
      .sort({ city: 1, name: 1 })
      .lean()
      .exec();
    return rows.map((z) => ({
      zoneId: z.zoneId,
      name: z.name,
      city: z.city,
      tier: z.tier,
    }));
  }

  /**
   * Estimativa de alcance e custo da campanha, **contada do banco**.
   *
   * Nao e um modelo de audiencia e nao finge ser: nao ha estimativa de passageiro alcancado
   * nem projecao de veiculacoes por dia por veiculo, porque nada no openad hoje sustenta
   * esses numeros sem inventar coeficiente. O que isto responde e o que da para responder com
   * honestidade: quantas zonas a segmentacao alcanca, quantos tablets existem para toca-la, e
   * quantas veiculacoes faturaveis o orcamento paga.
   *
   * O valor pratico esta nos `warnings`. A pergunta que o anunciante faz antes de pagar e
   * "isso vai rodar?", e a resposta errada mais comum e segmentacao que nao casa com zona
   * nenhuma — hoje isso so apareceria como campanha aprovada que nunca toca.
   */
  async estimar(campanha: CampaignDocument): Promise<EstimativaDeCampanha> {
    const seg = campanha.targeting;
    const warnings: string[] = [];

    const filtroZona: Record<string, unknown> = { isActive: true };
    if (seg?.zoneIds?.length) {
      filtroZona['zoneId'] = { $in: seg.zoneIds };
    }
    if (seg?.cities?.length) {
      filtroZona['city'] = { $in: seg.cities };
    }
    if (seg?.tiers?.length) {
      filtroZona['tier'] = { $in: seg.tiers };
    }

    const zonas = await this.zones
      .find(filtroZona)
      .select({ zoneId: 1, city: 1 })
      .lean()
      .exec();
    const cidades = [...new Set(zonas.map((z) => z.city))].sort();

    if (zonas.length === 0) {
      warnings.push(
        'A segmentacao nao alcanca nenhuma zona ativa: a campanha seria aprovada e nunca tocaria'
      );
    }

    /**
     * Elegibilidade do veiculo: ativo **e** com tablet vinculado.
     *
     * `pairedDeviceIds` vazio significa veiculo cadastrado sem tela. Conta-lo como alcance
     * seria vender inventario que nao existe — e e o erro mais facil de cometer aqui, porque
     * a frota cadastrada e sempre maior que a frota equipada.
     *
     * O veiculo **nao** tem cidade no schema, so o operador tem. Entao `targeting.cities`
     * filtra zona, nao veiculo: um tablet circula, e amarra-lo a uma cidade seria uma
     * precisao falsa.
     */
    const filtroVeiculo: Record<string, unknown> = {
      status: 'active',
      pairedDeviceIds: { $exists: true, $ne: [] },
    };
    if (seg?.vehicleTiers?.length) {
      filtroVeiculo['commercialTier'] = { $in: seg.vehicleTiers };
    }
    const vehiclesEligible = await this.vehicles
      .countDocuments(filtroVeiculo)
      .exec();

    if (vehiclesEligible === 0) {
      warnings.push(
        'Nenhum veiculo ativo com tablet vinculado atende aos tiers segmentados'
      );
    }

    const tarifa = campanha.budget.ratePerImpressionCents;
    const total = campanha.budget.totalAmountCents;
    const maxBillablePlays = tarifa > 0 ? Math.floor(total / tarifa) : 0;
    if (tarifa === 0) {
      warnings.push(
        'Tarifa por veiculacao e zero: a campanha toca como inventario institucional, sem faturar'
      );
    }

    const dailyBudgetCents = this.tetoDiarioCents(campanha);
    const maxDailyBillablePlays =
      tarifa > 0 ? Math.floor(dailyBudgetCents / tarifa) : 0;
    if (tarifa > 0 && maxDailyBillablePlays === 0) {
      warnings.push(
        'O teto diario nao cobre nem uma veiculacao: aumente o orcamento ou encurte a janela contratada'
      );
    }

    /**
     * Estimativa em **segundos de tela**, que é o que a campanha de fato compra.
     *
     * `maxBillablePlays` acima divide o orçamento pela tarifa por veiculação, e isso só
     * descreve a realidade em campanha `per_impression`. Com preço por segundo, exibições da
     * mesma campanha custam valores diferentes — uma imagem de 15 s e um vídeo de 60 s não são
     * a mesma coisa —, então "quantas exibições cabem" só faz sentido **por duração**.
     *
     * Os campos antigos continuam na resposta, de propósito: o app do anunciante publicado já
     * os consome, e a API só pode mudar de forma aditiva. Em campanha `per_second` eles
     * descrevem o modelo antigo e os novos descrevem o atual.
     */
    const monetizacao = this.platform.get().monetization;
    const precoPorSegundo =
      campanha.budget.pricePerSecondMicros ?? monetizacao.pricePerSecondMicros;
    const porSegundo = campanha.budget.pricingModel === 'per_second';
    const totalMicros = total * MICROS_POR_CENTAVO;

    const pricingTable = porSegundo
      ? tabelaDePreco(precoPorSegundo).map((l) => ({
          seconds: l.segundos,
          costMicros: l.custoMicros,
          /**
           * Quantas exibições daquela duração o orçamento cobre. É o número que o anunciante
           * usa para escolher entre "muitas exibições curtas" e "poucas longas".
           */
          maxPlays: veiculacoesQueOSaldoCobre({
            saldoMicros: totalMicros,
            pricePerSecondMicros: precoPorSegundo,
            segundos: l.segundos,
          }),
        }))
      : [];

    const maxBillableSeconds =
      porSegundo && precoPorSegundo > 0
        ? Math.floor(totalMicros / precoPorSegundo)
        : 0;

    if (porSegundo) {
      const segundosDeUmCiclo = monetizacao.creditCycleMinutes * 60;
      if (maxBillableSeconds < segundosDeUmCiclo) {
        /**
         * O crédito não cobre um ciclo de reserva inteiro. Vale avisar antes de ativar: a
         * campanha entraria no ar e sairia no ciclo seguinte, o que parece defeito.
         */
        warnings.push(
          `O orcamento cobre ${maxBillableSeconds} s de tela, menos que um ciclo de ` +
            `${monetizacao.creditCycleMinutes} min. A campanha sairia do ar no ciclo seguinte.`
        );
      }
    }

    return {
      campaignId: campanha.campaignId,
      zonesMatched: zonas.length,
      citiesMatched: cidades,
      vehiclesEligible,
      maxBillablePlays,
      dailyBudgetCents,
      maxDailyBillablePlays,
      currency: campanha.budget.currency,
      warnings,
      // Aditivos: cliente que não conhece ignora.
      pricingModel: campanha.budget.pricingModel ?? 'per_impression',
      pricePerSecondMicros: porSegundo ? precoPorSegundo : null,
      maxBillableSeconds,
      pricingTable,
    };
  }

  /**
   * Espelha `PacingSignalService.dailyBudgetCents`.
   *
   * Duplicacao consciente e pequena: importar o servico de pacing aqui arrastaria o modulo de
   * analytics inteiro para dentro do modulo do anunciante, e o pacing nao pertence a este
   * grafo. Se a formula mudar, o teste de estimativa quebra — e e para isso que ele existe.
   */
  private tetoDiarioCents(c: CampaignDocument): number {
    const explicito = c.budget.dailyBudgetCents ?? null;
    if (explicito !== null && explicito > 0) {
      return Math.floor(explicito);
    }
    const inicio = c.scheduledStart?.getTime?.() ?? Date.now();
    const fim = c.scheduledEnd?.getTime?.() ?? Date.now() + 86_400_000;
    const dias = Math.max(1, Math.ceil((fim - inicio) / 86_400_000));
    return Math.max(1, Math.floor(c.budget.totalAmountCents / dias));
  }
}
