import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlayRecordDocument = HydratedDocument<PlayRecord>;

const reconciliationStatuses = [
  'pending',
  'billable',
  'partial',
  'duplicate',
  'geofence_failed',
  'fraud_velocity',
  'fraud_heartbeat',
  'blackout',
  'audit',
] as const;

export type ReconciliationStatus = (typeof reconciliationStatuses)[number];

@Schema({ collection: 'play_records', timestamps: false })
export class PlayRecord {
  @Prop({ required: true })
  uniqueEventId!: string;

  @Prop({ required: true })
  deviceId!: string;

  @Prop({ required: true })
  vehicleId!: string;

  @Prop({ required: true })
  campaignId!: string;

  @Prop({ type: String, default: null })
  mediaId!: string | null;

  @Prop({ type: Date, required: true })
  timestampStart!: Date;

  @Prop({ type: Date, required: true })
  timestampEnd!: Date;

  @Prop({ type: Number, required: true })
  latStart!: number;

  @Prop({ type: Number, required: true })
  lngStart!: number;

  @Prop({ type: Number, required: true })
  latEnd!: number;

  @Prop({ type: Number, required: true })
  lngEnd!: number;

  @Prop({
    type: String,
    required: true,
    enum: ['Geofence_Entry', 'Standard_Loop', 'Admin_Force'],
  })
  triggerReason!: string;

  @Prop({ type: Number, required: true })
  batteryLevel!: number;

  @Prop({ type: String, required: true })
  networkType!: string;

  @Prop({ type: Number, required: true })
  gpsAccuracyM!: number;

  @Prop({ type: Number, default: null })
  displayLux!: number | null;

  @Prop({ type: Date, required: true })
  ingestedAt!: Date;

  @Prop({ type: String, required: true })
  batchId!: string;

  @Prop({
    type: String,
    required: true,
    enum: reconciliationStatuses,
  })
  reconciliationStatus!: ReconciliationStatus;

  @Prop({ type: Boolean, required: true })
  billable!: boolean;

  @Prop({ type: Number, default: null })
  impliedSpeedKmh!: number | null;

  @Prop({ type: Number, default: null })
  heartbeatRatio!: number | null;

  /**
   * Quando a cobrança desta veiculação foi aplicada. `null` significa "ainda não cobrada".
   *
   * **É o que torna a cobrança exatamente-uma-vez.** O índice único `(deviceId,
   * uniqueEventId)` garante uma *linha* por veiculação, não uma *cobrança*: o processor
   * detectava a transição "pendente → faturável" lendo o registro, reconciliando e lendo de
   * novo, e dois trabalhadores que lessem `pending` antes de qualquer um escrever enxergavam
   * os dois a mesma transição e somavam o custo duas vezes. O repasse ao motorista já estava
   * protegido pelo `referenceId`; o gasto da campanha não tinha proteção nenhuma.
   *
   * O campo é reivindicado por `findOneAndUpdate` condicionado a `billingAppliedAt: null`, que
   * no Mongo é atômico no documento. Quem recebe o documento de volta cobra; os demais não.
   *
   * Campo novo e anulável: registro antigo tem `undefined` aqui, e o filtro de reivindicação
   * usa `$in: [null, undefined]`... na verdade usa `{ billingAppliedAt: null }`, que no Mongo
   * casa tanto com nulo explícito quanto com ausente. Então veiculação já cobrada antes desta
   * mudança poderia ser cobrada uma vez a mais — e é por isso que a migração de dados marca o
   * que já é `billable` como aplicado (ver `scripts/`), em vez de deixar a dúvida.
   */
  @Prop({ type: Date, default: null })
  billingAppliedAt!: Date | null;
}

export const PlayRecordSchema = SchemaFactory.createForClass(PlayRecord);

PlayRecordSchema.index({ deviceId: 1, uniqueEventId: 1 }, { unique: true });
PlayRecordSchema.index({ campaignId: 1, timestampStart: -1 });
PlayRecordSchema.index({ vehicleId: 1, campaignId: 1, timestampStart: -1 });
PlayRecordSchema.index({ reconciliationStatus: 1, ingestedAt: -1 });
/**
 * Fila do padrão *outbox*: veiculação faturável que ainda não teve a cobrança aplicada.
 *
 * Mongo e Postgres não compartilham transação, então o débito do crédito do anunciante (que
 * vive no Postgres) nunca é atômico com a reivindicação aqui. A garantia vem de três coisas
 * juntas: reivindicação única neste documento, débito idempotente do outro lado, e um job que
 * varre esta fila refazendo o que ficou pela metade. Sem o índice, essa varredura seria uma
 * leitura da coleção inteira.
 */
PlayRecordSchema.index(
  { billingAppliedAt: 1, timestampEnd: 1 },
  { partialFilterExpression: { billable: true } }
);
