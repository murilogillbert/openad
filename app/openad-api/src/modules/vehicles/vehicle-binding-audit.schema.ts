import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VehicleBindingAuditDocument =
  HydratedDocument<VehicleBindingAuditEvent>;

@Schema({ collection: 'vehicle_binding_audit_events', timestamps: true })
export class VehicleBindingAuditEvent {
  @Prop({ type: String, required: true, unique: true })
  eventId!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['pair', 'unpair', 'decommission'],
  })
  action!: 'pair' | 'unpair' | 'decommission';

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
