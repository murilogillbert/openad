import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GeoZoneDocument = HydratedDocument<GeoZone>;

@Schema({ _id: false })
export class GeoJsonPolygon {
  @Prop({ type: String, required: true, enum: ['Polygon'] })
  type!: 'Polygon';

  @Prop({ type: [[[Number]]], required: true })
  coordinates!: number[][][];
}

@Schema({ _id: false })
export class GeoJsonCircle {
  @Prop({ type: String, required: true, enum: ['Circle'] })
  type!: 'Circle';

  @Prop({ type: Object, required: true })
  center!: { lng: number; lat: number };

  @Prop({ type: Number, required: true })
  radiusMeters!: number;
}

@Schema({ _id: false })
export class SpatialBinding {
  @Prop({ type: String, required: true })
  mediaId!: string;

  @Prop({ type: String, required: true, enum: ['entry', 'dwell'] })
  triggerMode!: 'entry' | 'dwell';

  @Prop({ type: Number, min: 0 })
  dwellSeconds?: number;

  @Prop({ type: Number, required: true, default: 60 })
  retriggerCooldownSeconds!: number;

  @Prop({
    type: String,
    required: true,
    enum: ['sequential', 'weighted_random', 'priority_first'],
    default: 'sequential',
  })
  rotationMode!: 'sequential' | 'weighted_random' | 'priority_first';

  @Prop({ type: Number })
  velocityMaxKmh?: number;

  @Prop({ type: Number })
  velocityMinKmh?: number;

  @Prop({
    type: Object,
    default: () => ({ wp: 1, wd: 1, wh: 1 }),
  })
  arbitrationWeights!: { wp: number; wd: number; wh: number };

  @Prop({ type: Number, default: 1 })
  pacingFactor!: number;

  @Prop({ type: Object })
  epicenter?: { lng: number; lat: number };
}

const SpatialBindingSchema = SchemaFactory.createForClass(SpatialBinding);

@Schema({ collection: 'geo_zones', timestamps: true })
export class GeoZone {
  @Prop({ required: true, unique: true })
  zoneId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, default: '' })
  description!: string;

  @Prop({ type: Object, required: true })
  geometry!: GeoJsonPolygon | GeoJsonCircle;

  @Prop({ required: true })
  city!: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: String, default: null })
  createdBy!: string | null;

  @Prop({ type: String, enum: ['T1', 'T2', 'T3', 'T4'], default: 'T4' })
  tier!: 'T1' | 'T2' | 'T3' | 'T4';

  @Prop({ type: Number, default: 0 })
  priorityScore!: number;

  @Prop({ type: Number, default: 20 })
  bufferExitMeters!: number;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: [SpatialBindingSchema], default: [] })
  bindings!: SpatialBinding[];
}

export const GeoZoneSchema = SchemaFactory.createForClass(GeoZone);

GeoZoneSchema.index(
  { geometry: '2dsphere' },
  { partialFilterExpression: { 'geometry.type': 'Polygon' } }
);
GeoZoneSchema.index({ city: 1, tags: 1 });
GeoZoneSchema.index({ tier: 1, isActive: 1 });
