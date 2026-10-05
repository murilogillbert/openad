import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VehicleBindingAuditDocument =
  HydratedDocument<VehicleBindingAuditEvent>;

@Schema({ collection: 'vehicle_binding_audit_events', timestamps: true })
export class VehicleBindingAuditEvent {
  @Prop({ type: String, required: true, unique: true })
  eventId!: string;

  /**
   * `driver_bind` e `driver_unbind` sao acrescimos, nao substituicoes.
   *
   * Vinculo de motorista decide **para quem vai dinheiro**: `vehicles.driverId` e a unica
   * fonte que o crédito de repasse e o relatorio de conferencia consultam. Uma troca de
   * motorista sem trilha torna impossivel responder "quem recebeu por esta veiculacao".
   * Entra nesta colecao, e nao numa nova, porque e a mesma pergunta — quem estava ligado a
   * este veiculo e quando — e o indice `{vehicleId, createdAt}` ja atende.
   *
   * Acrescentar valor a um enum do Mongoose e aditivo: documento antigo continua valido e
   * leitor antigo continua lendo. Nenhuma das rotas consumidas pelos aplicativos em revisao
   * le esta colecao.
   */
  @Prop({
    type: String,
    required: true,
    enum: ['pair', 'unpair', 'decommission', 'driver_bind', 'driver_unbind'],
  })
  action!:
    | 'pair'
    | 'unpair'
    | 'decommission'
    | 'driver_bind'
    | 'driver_unbind';

  @Prop({ type: String, required: true })
  vehicleId!: string;

  @Prop({ type: String, default: null })
  deviceId!: string | null;

  @Prop({ type: String, required: true })
  actorUserId!: string;

  @Prop({ type: String, default: null })
  actorEmail!: string | null;

  @Prop({ type: String, required: true })
  correlationId!: string;

  /** Set by Mongoose `timestamps: true`. */
  createdAt?: Date;
  updatedAt?: Date;
}

export const VehicleBindingAuditSchema = SchemaFactory.createForClass(
  VehicleBindingAuditEvent
);

VehicleBindingAuditSchema.index(
  { vehicleId: 1, createdAt: -1 },
  { name: 'vehicle_binding_audit_vehicle_created' }
);
VehicleBindingAuditSchema.index(
  { deviceId: 1, createdAt: -1 },
  { name: 'vehicle_binding_audit_device_created', sparse: true }
);
