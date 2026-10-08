import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import type { CampaignDocument } from '../../campaigns/campaign.schema';
import {
  CampaignDailySpend,
  type PacingState,
} from '../schemas/campaign-daily-spend.schema';
import { MICROS_POR_CENTAVO } from '../../monetization/pricing.policy';

/** Spend ≥ this fraction of daily budget → near_cap (FR-012 / SC-006). */
const NEAR_CAP_FRACTION = 0.95;

@Injectable()
export class PacingSignalService {
  constructor(
    @InjectModel(CampaignDailySpend.name)
    private readonly dailySpend: Model<CampaignDailySpend>,
    private readonly campaigns: CampaignsRepository
  ) {}

  /**
   * Multiplier applied to spatial manifest `pacingFactor` when a campaign is near daily cap.
   */
  async getPacingDeliveryMultiplier(campaignId: string): Promise<number> {
    const row = await this.findTodayRow(campaignId);
    if (!row) {
      return 1;
    }
    if (row.pacingState === 'paused') {
      return 0.1;
    }
    if (row.pacingState === 'near_cap') {
      return 0.5;
    }
    return 1;
  }

  async getSnapshot(campaignId: string): Promise<{
    campaignId: string;
    dateKey: string;
    billableCostCents: number;
    budgetCents: number;
    pacingState: PacingState;
  } | null> {
    const row = await this.findTodayRow(campaignId);
    if (!row) {
      return null;
    }
    return {
      campaignId: row.campaignId,
      dateKey: row.dateKey,
      billableCostCents: row.billableCostCents,
      budgetCents: row.budgetCents,
      pacingState: row.pacingState,
    };
  }

  /**
   * Increment daily billable cost after a play is classified billable (post fraud).
   */
  /**
   * Acumula o custo de uma veiculação faturável no gasto do dia.
   *
   * O parâmetro passou de `costCents` para `costMicros`. O motivo é que o preço acordado é
   * R$ 0,003 por segundo: uma imagem de 15 s custa 4,5 centavos, e o acumulador contava em
   * centavos inteiros com `Math.round`. Arredondar por veiculação perderia meio centavo de
   * 4,5 (11%), sempre contra o mesmo lado, multiplicado por milhões de veiculações.
   *
   * `billableCostMicros` é o acumulador exato. `billableCostCents` continua sendo mantido,
   * derivado dele por `floor`, porque é o que o pacing compara com o orçamento e o que telas
   * e relatórios já leem — mudar os dois ao mesmo tempo quebraria leitores que não têm nada
   * a ver com esta frente.
   */
  async recordBillablePlayCost(params: {
    campaignId: string;
    costMicros: number;
    at: Date;
  }): Promise<void> {
    if (params.costMicros <= 0) {
      return;
    }
    const campaign = await this.campaigns.findByCampaignId(params.campaignId);
    if (!campaign) {
      return;
    }
    const dateKey = utcDateKey(params.at);
    const budgetCents = this.dailyBudgetCents(campaign);

    await this.dailySpend.updateOne(
      { campaignId: params.campaignId, dateKey },
      {
        $setOnInsert: {
          campaignId: params.campaignId,
          dateKey,
          budgetCents,
          pacingState: 'normal',
        },
        $inc: { billableCostMicros: Math.floor(params.costMicros) },
      },
      { upsert: true }
    );

    const row = await this.dailySpend
      .findOne({ campaignId: params.campaignId, dateKey })
      .lean()
      .exec();
    if (!row) {
      return;
    }

    /**
     * `billableCostCents` derivado do acumulador em micro-reais, por `floor`.
     *
     * Derivado e não incrementado em paralelo: dois acumuladores independentes divergiriam, e
     * o que divergiria é a base de comparação com o orçamento. Aqui o centavo é sempre
     * `floor(micros)` do total — o meio centavo não se perde, fica no acumulador exato até
     * completar o próximo centavo.
     *
     * **Só sobe, nunca desce.** Uma linha gravada antes deste campo existir já tem centavos
     * acumulados e `billableCostMicros` ausente; o acumulador em micro-reais começa do zero
     * para ela. Sem esta guarda, a primeira veiculação do dia sobrescreveria o gasto
     * acumulado por um total muito menor — e o pacing voltaria a liberar uma campanha que já
     * tinha estourado o orçamento.
     *
     * A guarda é defesa em profundidade: `scripts/semear-gasto-em-micros.ts` converte o
     * acervo e torna o número exato. A guarda garante que esquecer o script custe uma
     * contagem conservadora e não perda de dado.
     */
    const centavosDoTotal = Math.floor(
      (row.billableCostMicros ?? 0) / MICROS_POR_CENTAVO
    );
    const centavosVigentes = Math.max(centavosDoTotal, row.billableCostCents ?? 0);
    if (centavosVigentes !== row.billableCostCents) {
      await this.dailySpend.updateOne(
        { campaignId: params.campaignId, dateKey },
        { $set: { billableCostCents: centavosVigentes } }
      );
    }

    const next = this.resolvePacingState(centavosVigentes, row.budgetCents);
    if (next !== row.pacingState) {
      await this.dailySpend.updateOne(
        { campaignId: params.campaignId, dateKey },
        { $set: { pacingState: next } }
      );
    }
  }

  private resolvePacingState(
    spent: number,
    budget: number
  ): PacingState {
    if (budget <= 0) {
      return 'normal';
    }
    if (spent >= budget) {
      return 'paused';
    }
    if (spent >= budget * NEAR_CAP_FRACTION) {
      return 'near_cap';
    }
    return 'normal';
  }

  /**
   * Teto diario em centavos.
   *
   * **Isto estava errado por um fator de 100.** A versao anterior dividia
   * `budget.totalAmount`, que era float em unidade maior (reais), e comparava o resultado com
   * `billableCostCents`, que sempre contou centavos. Um orcamento de 1.000 virava 33 "centavos"
   * por dia, e a campanha era pausada praticamente na primeira veiculacao. Com o orcamento em
   * centavos, a divisao e homogenea.
   *
   * `dailyBudgetCents` explicito tem precedencia: anunciante que quer gastar devagar define o
   * teto, em vez de depender da divisao pelos dias contratados.
   */
  private dailyBudgetCents(c: CampaignDocument): number {
    const tetoExplicito = c.budget?.dailyBudgetCents ?? null;
    if (tetoExplicito !== null && tetoExplicito > 0) {
      return Math.floor(tetoExplicito);
    }
    const totalCents = c.budget?.totalAmountCents ?? 0;
    const start = c.scheduledStart?.getTime?.() ?? Date.now();
    const end = c.scheduledEnd?.getTime?.() ?? Date.now() + 86400000;
    const days = Math.max(1, Math.ceil((end - start) / 86400000));
    return Math.max(1, Math.floor(totalCents / days));
  }

  private async findTodayRow(
    campaignId: string
  ): Promise<CampaignDailySpend | null> {
    const dateKey = utcDateKey(new Date());
    return this.dailySpend.findOne({ campaignId, dateKey }).exec();
  }
}

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
