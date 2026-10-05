import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';
import { PlayRecord } from '../analytics/schemas/play-record.schema';
import { Vehicle, VehicleDocument } from '../vehicles/vehicles.schema';
import { repasseEmCentavos } from './driver-payout.policy';

export interface RepassePorMotorista {
  /** `public.users.id` do motorista. */
  driverUserId: string;
  billablePlays: number;
  /** Receita faturável gerada por este motorista, em centavos. */
  grossCents: number;
  /** Repasse devido a ele, em centavos. */
  payoutCents: number;
}

export interface RelatorioDeRepasse {
  window: { from: string; to: string };
  billablePlays: number;
  grossCents: number;
  payoutCents: number;
  /** Veiculações faturáveis que não puderam ser atribuídas a um motorista. */
  unattributedPlays: number;
  drivers: RepassePorMotorista[];
}

@Injectable()
export class AdPayoutsReportService {
  constructor(
    @InjectModel(PlayRecord.name)
    private readonly playRecords: Model<PlayRecord>,
    @InjectModel(Vehicle.name)
    private readonly vehicles: Model<VehicleDocument>,
    private readonly campaigns: CampaignsRepository,
    private readonly platform: PlatformConfigRuntimeService
  ) {}

  /**
   * Repasse devido por motorista num período, recalculado do zero.
   *
   * Isto **não credita nada** — o crédito acontece no instante em que a veiculação vira
   * faturável, direto em `opendriver.driver_earnings`. Esta rota existe para que o número
   * possa ser conferido por um caminho independente: o hub (ou uma auditoria) soma aqui e
   * compara com o livro-caixa do opendriver. Dois totais calculados de formas diferentes que
   * deveriam bater; divergência é sinal de lançamento perdido ou duplicado.
   *
   * A fonte é `play_records` com `reconciliationStatus: 'billable'`, não `impression_events`:
   * é a coleção que passou por reconciliação de duração e pelas regras de antifraude. Pagar
   * sobre o que o tablete reportou, sem esse filtro, é pagar por fraude.
   */
  async porMotorista(from: Date, to: Date): Promise<RelatorioDeRepasse> {
    const piso = this.platform.get().monetization.driverPayoutMinPercent;

    const linhas = (await this.playRecords.aggregate([
      {
        $match: {
          reconciliationStatus: 'billable',
          timestampStart: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: { vehicleId: '$vehicleId', campaignId: '$campaignId' },
          plays: { $sum: 1 },
        },
      },
    ])) as Array<{
      _id: { vehicleId: string; campaignId: string };
      plays: number;
    }>;

    // Cache das duas resoluções: um período com muitas veiculações repete os mesmos poucos
    // veículos e campanhas milhares de vezes.
    const motoristaPorVeiculo = new Map<string, string | null>();
    const campanhaPorId = new Map<
      string,
      { rateCents: number; repasse: Awaited<ReturnType<typeof this.lerRepasse>> } | null
    >();

    const porMotorista = new Map<string, RepassePorMotorista>();
    let billablePlays = 0;
    let grossCents = 0;
    let payoutCents = 0;
    let unattributedPlays = 0;

    for (const linha of linhas) {
      const { vehicleId, campaignId } = linha._id;
      billablePlays += linha.plays;

      if (!campanhaPorId.has(campaignId)) {
        const c = await this.campaigns.findByCampaignId(campaignId);
        campanhaPorId.set(
          campaignId,
          c
            ? {
                rateCents: c.budget?.ratePerImpressionCents ?? 0,
                repasse: this.lerRepasse(c.driverPayout),
              }
            : null
        );
      }
      const campanha = campanhaPorId.get(campaignId);
      if (!campanha) {
        // Campanha apagada depois da veiculação. A receita existiu, mas não há tarifa para
        // recalcular — contar como atribuída com valor zero esconderia o problema.
        unattributedPlays += linha.plays;
        continue;
      }

      if (!motoristaPorVeiculo.has(vehicleId)) {
        const v = await this.vehicles
          .findOne({ vehicleId })
          .select({ driverId: 1 })
          .lean()
          .exec();
        motoristaPorVeiculo.set(vehicleId, v?.driverId ?? null);
      }
      const driverUserId = motoristaPorVeiculo.get(vehicleId) ?? null;

      const bruto = campanha.rateCents * linha.plays;
      const repasse =
        repasseEmCentavos({
          valorFaturavelCents: campanha.rateCents,
          repasse: campanha.repasse,
          piso,
        }) * linha.plays;

      grossCents += bruto;

      if (!driverUserId) {
        /**
         * Veículo sem motorista vinculado. Acontece de verdade: `vehicles.driverId` é
         * preenchido no vínculo e pode ficar nulo entre a saída de um motorista e a entrada
         * de outro, enquanto o tablete continua tocando.
         *
         * A receita entra em `grossCents` — ela foi faturada — mas o repasse **não** é
         * somado, porque não há a quem pagar. Expor isso como `unattributedPlays` em vez de
         * silenciar é o que permite alguém notar e corrigir o vínculo.
         */
        unattributedPlays += linha.plays;
        continue;
      }

      payoutCents += repasse;
      const atual = porMotorista.get(driverUserId) ?? {
        driverUserId,
        billablePlays: 0,
        grossCents: 0,
        payoutCents: 0,
      };
      atual.billablePlays += linha.plays;
      atual.grossCents += bruto;
      atual.payoutCents += repasse;
      porMotorista.set(driverUserId, atual);
    }

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      billablePlays,
      grossCents,
      payoutCents,
      unattributedPlays,
      drivers: [...porMotorista.values()].sort(
        (a, b) => b.payoutCents - a.payoutCents
      ),
    };
  }

  /**
   * Anúncios que tocaram nos veículos deste motorista dentro de uma janela de tempo.
   *
   * Existe para que o **opendriver** possa somar a receita de anúncio à corrida na tela de
   * Ganhos. O openad não conhece corrida — não há entidade, coleção nem evento de trajeto
   * aqui — então a única pergunta que ele sabe responder é "o que tocou entre estes dois
   * instantes". Quem conhece início e fim do trajeto é o opendriver; ele passa a janela.
   *
   * O recorte por motorista é indireto, pelo mesmo caminho do crédito: veículos cujo
   * `driverId` é ele, e `play_records` desses veículos. Um motorista com N tablets no mesmo
   * veículo tem todos contemplados, porque `pairedDeviceIds` é um array e o play record
   * carrega `vehicleId`.
   *
   * Só `reconciliationStatus: 'billable'`. Veiculação reprovada na reconciliação de duração
   * ou nas regras de antifraude **não** entra: mostrar ao motorista um ganho que não foi
   * creditado é pior que não mostrar nada.
   */
  async veiculacoesDoMotorista(
    driverUserId: string,
    from: Date,
    to: Date
  ): Promise<{
    driverUserId: string;
    window: { from: string; to: string };
    plays: number;
    payoutCents: number;
    payoutMinPercent: number;
    items: Array<{
      playedAt: string;
      campaignId: string;
      mediaId: string | null;
      vehicleId: string;
      payoutCents: number;
    }>;
  }> {
    const piso = this.platform.get().monetization.driverPayoutMinPercent;

    const veiculos = await this.vehicles
      .find({ driverId: driverUserId })
      .select({ vehicleId: 1 })
      .lean()
      .exec();
    const vehicleIds = veiculos.map((v) => v.vehicleId);

    if (vehicleIds.length === 0) {
      return {
        driverUserId,
        window: { from: from.toISOString(), to: to.toISOString() },
        plays: 0,
        payoutCents: 0,
        payoutMinPercent: piso,
        items: [],
      };
    }

    const registros = await this.playRecords
      .find({
        vehicleId: { $in: vehicleIds },
        reconciliationStatus: 'billable',
        timestampEnd: { $gte: from, $lte: to },
      })
      .select({
        timestampEnd: 1,
        campaignId: 1,
        mediaId: 1,
        vehicleId: 1,
      })
      .sort({ timestampEnd: 1 })
      .lean()
      .exec();

    // Mesmo cache de campanha do relatório: uma janela repete poucas campanhas muitas vezes.
    const campanhaPorId = new Map<string, number>();
    const items: Array<{
      playedAt: string;
      campaignId: string;
      mediaId: string | null;
      vehicleId: string;
      payoutCents: number;
    }> = [];
    let payoutCents = 0;

    for (const r of registros) {
      if (!campanhaPorId.has(r.campaignId)) {
        const c = await this.campaigns.findByCampaignId(r.campaignId);
        campanhaPorId.set(
          r.campaignId,
          repasseEmCentavos({
            valorFaturavelCents: c?.budget?.ratePerImpressionCents ?? 0,
            repasse: this.lerRepasse(c?.driverPayout),
            piso,
          })
        );
      }
      const valor = campanhaPorId.get(r.campaignId) ?? 0;
      payoutCents += valor;
      items.push({
        playedAt: new Date(r.timestampEnd).toISOString(),
        campaignId: r.campaignId,
        mediaId: r.mediaId ?? null,
        vehicleId: r.vehicleId,
        payoutCents: valor,
      });
    }

    return {
      driverUserId,
      window: { from: from.toISOString(), to: to.toISOString() },
      plays: registros.length,
      payoutCents,
      payoutMinPercent: piso,
      items,
    };
  }

  private lerRepasse(
    dp:
      | { model: 'percent' | 'per_play'; percent: number | null; valueCents: number | null }
      | null
      | undefined
  ) {
    return dp
      ? { model: dp.model, percent: dp.percent, valueCents: dp.valueCents }
      : null;
  }
}
