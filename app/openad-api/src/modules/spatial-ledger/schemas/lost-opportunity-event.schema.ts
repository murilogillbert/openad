import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type LostOpportunityEventDocument =
  HydratedDocument<LostOpportunityEventRecord>;

@Schema({ collection: 'lost_opportunity_events', timestamps: false })
export class LostOpportunityEventRecord {
  @Prop({ required: true, unique: true })
  eventId!: string;

  @Prop({ required: true })
  deviceId!: string;

  @Prop({ required: true })
  suppressedMediaId!: string;

  @Prop({ type: String, default: null })
  winningMediaId!: string | null;

  /**
   * `revenue_share` cobre supressao pelo leilao de repasse: campanha que oferece menos ao
   * motorista perde inventario. Sem registrar o motivo, leilao e caixa-preta e vira disputa
   * com o parceiro.
   */
  @Prop({
    type: String,
    required: true,
    enum: [
      'higher_tier',
      'cooldown',
      'velocity',
      'pacing',
      'revenue_share',
      'loop_lock',
      'other',
    ],
  })
  reason!:
    | 'higher_tier'
    | 'cooldown'
    | 'velocity'
    | 'pacing'
    | 'revenue_share'
    | 'loop_lock'
    | 'other';

  @Prop({ required: true })
  zoneId!: string;

  @Prop({ required: true })
  ts!: string;

  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  @Prop({ type: String, default: null })
  mqttDeliveryId!: string | null;
}

export const LostOpportunityEventSchema = SchemaFactory.createForClass(
  LostOpportunityEventRecord
);

LostOpportunityEventSchema.index({ deviceId: 1, ts: 1 });
LostOpportunityEventSchema.index({ zoneId: 1, ts: 1 });
