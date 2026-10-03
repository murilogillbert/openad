import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CampaignDocument = HydratedDocument<Campaign>;

/**
 * Orcamento da campanha, em **centavos inteiros**.
 *
 * Era float (`totalAmount`, `ratePerImpression`) e isso produzia um defeito real, nao apenas
 * divida tecnica: `PacingSignalService.dailyBudgetCents` dividia `totalAmount` pelos dias e
 * comparava o resultado com `campaign_daily_spend.billableCostCents`, que sempre contou em
 * centavos. Um orcamento de 1.000 virava 33 "centavos" por dia e a campanha era pausada
 * praticamente na primeira veiculacao — cem vezes mais cedo do que devia.
 *
 * O ecossistema guarda dinheiro em `Decimal(12,2)` **em reais** no Postgres do hub; a conversao
 * para duas casas acontece so na fronteira, nunca aqui.
 */
@Schema({ _id: false })
export class CampaignBudgetSubdoc {
  /** Orcamento total da campanha, em centavos inteiros. */
  @Prop({ type: Number, required: true, min: 0 })
  totalAmountCents!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  /** Tarifa por veiculacao faturavel, em centavos inteiros. */
  @Prop({ type: Number, required: true, min: 0 })
  ratePerImpressionCents!: number;

  /**
   * Teto diario, em centavos. Opcional: quando ausente, o pacing deriva do total dividido
   * pelos dias contratados, que e o comportamento anterior.
   */
  @Prop({ type: Number, default: null })
  dailyBudgetCents!: number | null;
}
const CampaignBudgetSchema = SchemaFactory.createForClass(CampaignBudgetSubdoc);

export const CAMPAIGN_STATUSES = [
  'draft',
  'pending_review',
  'rejected',
  'active',
  'paused',
  'completed',
  'archived',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

@Schema({ _id: false })
export class CampaignModerationSubdoc {
  /** `openad.users.userId` do moderador que decidiu. */
  @Prop({ type: String, required: true })
  reviewedByUserId!: string;

  @Prop({ type: Date, required: true })
  reviewedAt!: Date;

  @Prop({ type: String, required: true, enum: ['approved', 'rejected'] })
  decision!: 'approved' | 'rejected';

  /** Obrigatorio na recusa: o anunciante precisa saber o que corrigir. */
  @Prop({ type: String, default: null })
  reason!: string | null;
}
const CampaignModerationSchema = SchemaFactory.createForClass(
  CampaignModerationSubdoc
);

@Schema({ _id: false })
export class CampaignTargetingSubdoc {
  @Prop({ type: [String], default: [] })
  cities!: string[];

  @Prop({ type: [String], default: [] })
  zoneIds!: string[];

  /** Tiers de zona aceitos (`geo_zones.tier`). Vazio = todos. */
  @Prop({ type: [String], default: [] })
  tiers!: string[];

  /** Tiers comerciais de veiculo (`vehicles.commercialTier`). Vazio = todos. */
  @Prop({ type: [String], default: [] })
  vehicleTiers!: string[];

  /** Faixas horarias no formato `HH:mm-HH:mm`. Vazio = dia inteiro. */
  @Prop({ type: [String], default: [] })
  dayparts!: string[];
}
const CampaignTargetingSchema = SchemaFactory.createForClass(
  CampaignTargetingSubdoc
);

@Schema({ _id: false })
export class CampaignDriverPayoutSubdoc {
  /**
   * `percent` — fracao do valor faturavel; `per_play` — valor fixo por veiculacao.
   */
  @Prop({ type: String, required: true, enum: ['percent', 'per_play'] })
  model!: 'percent' | 'per_play';

  @Prop({ type: Number, default: null })
  percent!: number | null;

  @Prop({ type: Number, default: null })
  valueCents!: number | null;
}
const CampaignDriverPayoutSchema = SchemaFactory.createForClass(
  CampaignDriverPayoutSubdoc
);

@Schema({ collection: 'campaigns', timestamps: true })
export class Campaign {
  @Prop({ type: String, required: true })
  campaignId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  advertiserName!: string;

  /**
   * Dono da campanha — `public.users.id` no Postgres compartilhado do ecossistema.
   *
   * Nulo nas campanhas criadas internamente pelo operador, que e o caso de tudo que
   * existia antes da federacao de identidade. Toda consulta do anunciante filtra por este
   * campo; sem ele, um parceiro veria e baixaria a midia dos outros.
   */
  @Prop({ type: String, default: null })
  ownerUserId!: string | null;

  /** `public.ad_advertisers.id`. */
  @Prop({ type: String, default: null })
  advertiserId!: string | null;

  /** `public.ad_credit_purchases.id` que custeou a campanha, quando houver. */
  @Prop({ type: String, default: null })
  orderId!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: CAMPAIGN_STATUSES,
  })
  status!: CampaignStatus;

  /** Decisao de moderacao mais recente. */
  @Prop({ type: CampaignModerationSchema, default: null })
  moderation!: CampaignModerationSubdoc | null;

  /** Segmentacao. Campos vazios significam "sem restricao". */
  @Prop({ type: CampaignTargetingSchema, default: () => ({}) })
  targeting!: CampaignTargetingSubdoc;

  /**
   * Repasse ao motorista, definido pelo parceiro, com piso em
   * `platform_config.monetization.driverPayoutMinPercent`.
   */
  @Prop({ type: CampaignDriverPayoutSchema, default: null })
  driverPayout!: CampaignDriverPayoutSubdoc | null;

  /** Lower number = higher priority (1 = highest). */
  @Prop({ type: Number, required: true })
  priority!: number;

  /**
   * Era `type: Object`, o que fazia o Mongoose **nao validar nem converter** nada aqui dentro:
   * um `totalAmountCents` em texto, ou negativo, entrava no banco sem reclamar. Agora usa o
   * schema do subdocumento, com os `min: 0` valendo.
   */
  @Prop({ type: CampaignBudgetSchema, required: true })
  budget!: CampaignBudgetSubdoc;

  @Prop({ type: Date, required: true })
  scheduledStart!: Date;

  @Prop({ type: Date, required: true })
  scheduledEnd!: Date;

  @Prop({ type: String, default: null })
  createdBy!: string | null;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);

CampaignSchema.index({ campaignId: 1 }, { unique: true, name: 'campaignId_1' });

CampaignSchema.index({ status: 1, scheduledStart: 1, scheduledEnd: 1 });
CampaignSchema.index({ priority: 1, status: 1 });

/** Listagem do anunciante — sempre escopada pelo dono. */
CampaignSchema.index(
  { ownerUserId: 1, status: 1, updatedAt: -1 },
  { name: 'owner_status_updated', sparse: true }
);

/** Fila de moderacao. */
CampaignSchema.index({ status: 1, createdAt: 1 }, { name: 'moderation_queue' });
