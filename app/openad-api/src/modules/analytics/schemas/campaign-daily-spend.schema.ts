import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CampaignDailySpendDocument = HydratedDocument<CampaignDailySpend>;

const pacingStates = ['normal', 'near_cap', 'paused'] as const;

export type PacingState = (typeof pacingStates)[number];

@Schema({ collection: 'campaign_daily_spend', timestamps: true })
export class CampaignDailySpend {
  @Prop({ required: true })
  campaignId!: string;

  /** UTC calendar day `YYYY-MM-DD` for v1 rollup. */
  @Prop({ required: true })
  dateKey!: string;

  @Prop({ required: true, default: 0 })
  billableCostCents!: number;

  /**
   * Acumulador **exato** do gasto do dia, em micro-reais.
   *
   * `billableCostCents` acima é derivado deste por `floor`, e não incrementado em paralelo.
   * Existe porque o preço por segundo (R$ 0,003/s) produz custos com fração de centavo: uma
   * imagem de 15 s custa 4,5 centavos. Acumular em centavos com arredondamento perderia meio
   * centavo por veiculação, sempre contra o mesmo lado.
   *
   * **Opcional no tipo, e isso é intencional.** Linha gravada antes desta mudança não tem o
   * campo, e dizer `number` obrigatório faria o compilador afirmar algo falso sobre o que vem
   * do banco — o código de leitura usa `?? 0` justamente porque o valor pode não estar lá.
   * `default: 0` cobre documento novo; `required: true` seria uma promessa que o acervo não
   * cumpre.
   */
  @Prop({ type: Number, default: 0 })
  billableCostMicros?: number;

  /** Snapshot of interpreted daily budget cap (minor units, same as campaign budget). */
  @Prop({ required: true, default: 0 })
  budgetCents!: number;

  @Prop({
    type: String,
    required: true,
    enum: pacingStates,
    default: 'normal',
  })
  pacingState!: PacingState;
}

export const CampaignDailySpendSchema =
  SchemaFactory.createForClass(CampaignDailySpend);

CampaignDailySpendSchema.index(
  { campaignId: 1, dateKey: 1 },
  { unique: true }
);
