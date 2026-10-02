import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { DeviceLifecycleState, EventTriggerType } from '@openad/domain';

@Schema({ _id: false })
class DeviceLifecycleEventTriggerSub {
  @Prop({ type: String, enum: ['system', 'admin'], required: true })
  type!: EventTriggerType;

  @Prop({ type: String, required: true })
  detail!: string;

  @Prop({ type: String, required: false })
  actorId?: string;
}

const DeviceLifecycleEventTriggerSchema = SchemaFactory.createForClass(
  DeviceLifecycleEventTriggerSub
);

export type DeviceLifecycleEventDocument = HydratedDocument<DeviceLifecycleEvent>;

@Schema({ collection: 'device_lifecycle_events', timestamps: false })
export class DeviceLifecycleEvent {
  @Prop({ required: true, unique: true })
  eventId!: string;

  @Prop({ required: true, index: true })
  deviceId!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['Pending', 'Active', 'Flagged', 'Suspended', 'Retired'],
  })
  fromState!: DeviceLifecycleState;

  @Prop({
    type: String,
    required: true,
    enum: ['Pending', 'Active', 'Flagged', 'Suspended', 'Retired'],
  })
  toState!: DeviceLifecycleState;

  @Prop({ type: DeviceLifecycleEventTriggerSchema, required: true })
  trigger!: DeviceLifecycleEventTriggerSub;

  @Prop({ type: Date, required: true })
  occurredAt!: Date;
}

export const DeviceLifecycleEventSchema =
  SchemaFactory.createForClass(DeviceLifecycleEvent);

DeviceLifecycleEventSchema.index({ deviceId: 1, occurredAt: -1 });
DeviceLifecycleEventSchema.index({ occurredAt: -1 });
DeviceLifecycleEventSchema.index({ toState: 1, occurredAt: -1 });
