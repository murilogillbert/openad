import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ImpressionEventDocument = HydratedDocument<ImpressionEventRecord>;

/** Immutable impression (`data-model.md` — `impression_events`). Append-only in application code. */
@Schema({ collection: 'impression_events', timestamps: false })
export class ImpressionEventRecord {
  @Prop({ type: String, required: true })
  eventId!: string;

  @Prop({ required: true })
  campaignId!: string;

  @Prop({ required: true })
  scheduleRuleId!: string;

  @Prop({ required: true })
  assetId!: string;

  @Prop({ required: true })
  vehicleId!: string;

  @Prop({ required: true })
  deviceId!: string;

  @Prop({ type: Date, required: true })
  playedAt!: Date;

  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  @Prop({ type: Number, required: true })
  durationPlayedSeconds!: number;

  @Prop({
    type: {
      type: String,
      enum: ['Point'],
      required: true,
    },
    coordinates: { type: [Number], required: true },
  })
  location!: { type: 'Point'; coordinates: [number, number] };

  @Prop({ type: Number, default: null })
  accuracyMeters!: number | null;

  @Prop({ type: Boolean, required: true })
  locationVerified!: boolean;

  /**
   * Valor faturavel desta veiculacao, em **centavos inteiros**, congelado no momento do
   * evento.
   *
   * E instantaneo de propósito: a tarifa da campanha pode mudar depois, e a fatura ja emitida
   * nao pode mudar com ela.
   */
  @Prop({ type: Number, required: true, min: 0 })
  billingValueCents!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: String, default: null })
  mqttDeliveryId!: string | null;
}

export const ImpressionEventSchema =
  SchemaFactory.createForClass(ImpressionEventRecord);

ImpressionEventSchema.index({ eventId: 1 }, { unique: true, name: 'eventId_1' });

ImpressionEventSchema.index({ campaignId: 1, playedAt: 1 });
ImpressionEventSchema.index({ vehicleId: 1, playedAt: -1 });
ImpressionEventSchema.index({ location: '2dsphere' });
ImpressionEventSchema.index({ locationVerified: 1, campaignId: 1 });
