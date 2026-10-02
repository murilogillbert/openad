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
VehicleSchema.index(
  { registrationPlate: 1 },
  {
    unique: true,
    name: 'registrationPlate_active_unique',
    partialFilterExpression: { status: { $ne: 'decommissioned' } },
  }
);

