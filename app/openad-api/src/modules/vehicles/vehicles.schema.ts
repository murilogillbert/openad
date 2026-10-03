import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type {
  VehicleCharacteristics,
  VehicleStatus,
} from '@openad/domain';

export type VehicleDocument = HydratedDocument<Vehicle>;

@Schema({ collection: 'vehicles', timestamps: true })
export class Vehicle {
  @Prop({ type: String, required: true })
  vehicleId!: string;

  @Prop({ type: String, required: true })
  registrationPlate!: string;

  @Prop({ required: true })
  make!: string;

  @Prop({ required: true })
  model!: string;

  @Prop({ required: true, default: 2024 })
  year!: number;

  @Prop({
    type: String,
    required: true,
    enum: ['active', 'inactive', 'decommissioned'],
  })
  status!: VehicleStatus;

  /** Bound tablet device IDs (`devices.deviceId`, UUID strings). */
  @Prop({ type: [String], default: [] })
  pairedDeviceIds!: string[];

  @Prop({ required: true })
  operatorId!: string;

  @Prop({
    type: Object,
    required: true,
    default: (): VehicleCharacteristics => ({
      screenCount: 1,
      passengerCapacity: 4,
    }),
  })
  characteristics!: VehicleCharacteristics;

  @Prop({ type: Date, default: null })
  decommissionedAt!: Date | null;

  /** Commercial tier for roster rules and fleet map filters. */
  @Prop({
    type: String,
    enum: ['premium', 'taxi', 'van', 'other'],
    default: 'other',
  })
  commercialTier!: 'premium' | 'taxi' | 'van' | 'other';

  @Prop({ type: String, default: null })
  driverId!: string | null;

  /** In-shop / maintenance: roster binding UI treats as in_shop when true. */
  @Prop({ type: Boolean, default: false })
  inShop!: boolean;
}

export const VehicleSchema = SchemaFactory.createForClass(Vehicle);

VehicleSchema.index({ vehicleId: 1 }, { unique: true, name: 'vehicleId_1' });
// Placa única entre os veículos que ainda estão em operação — um veículo desativado não deve
// bloquear o recadastro da mesma placa.
//
// O filtro é `$in` e não `$ne`: o MongoDB **recusa** `$not`/`$ne` em
// `partialFilterExpression` ("Expression not supported in partial index"), e a recusa derruba
// o `syncIndexes()` inteiro — ou seja, a placa ficava sem nenhuma restrição de unicidade, em
// silêncio, porque `IndexEnsureService` só registra aviso. Como `status` é um enum fechado de
// três valores, enumerar os dois que interessam é equivalente e é aceito.
VehicleSchema.index(
  { registrationPlate: 1 },
  {
    unique: true,
    name: 'registrationPlate_active_unique',
    partialFilterExpression: { status: { $in: ['active', 'inactive'] } },
  }
);

