import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type {
  CapabilityManifest,
  DeviceHardwareProfile,
  DeviceLifecycleState,
  HealthMetrics,
} from '@openad/domain';

export type DeviceDocument = HydratedDocument<Device>;

@Schema({ collection: 'devices', timestamps: true })
export class Device {
  @Prop({ type: String, required: true })
  deviceId!: string;

  @Prop({ type: String, required: true })
  serialNumber!: string;

  @Prop({
    type: String,
    enum: ['Pending', 'Active', 'Flagged', 'Suspended', 'Retired'],
    required: true,
    default: 'Pending',
  })
  lifecycleState!: DeviceLifecycleState;

  @Prop({ type: String, default: null })
  groupId!: string | null;

  /** Vehicle `vehicleId` (UUID string). */
  @Prop({ type: String, default: null })
  boundVehicleId!: string | null;

  @Prop({ type: Date, default: null })
  boundAt!: Date | null;

  @Prop({ type: Object, required: true })
  hardwareProfile!: DeviceHardwareProfile;

  @Prop({ type: Object, required: false, default: null })
  capabilityManifest!: CapabilityManifest | null;

  @Prop({ required: true })
  mqttClientId!: string;

  @Prop({ required: true })
  certificateThumbprint!: string;

  @Prop({ type: Date, required: true })
  lastSeenAt!: Date;

  @Prop({ type: Object, required: false, default: null })
  lastHealthMetrics!: HealthMetrics | null;

  /** SHA-256 hardware fingerprint (003 tablet ops). */
  @Prop({ type: String, required: false, default: null })
  hardwareFingerprintHash!: string | null;

  /** Monotonic manifest version for delta sync (003). */
  @Prop({ type: Number, required: false, default: 0 })
  lastManifestVersion!: number;

  @Prop({ type: Date, required: false, default: null })
  pairingCompletedAt!: Date | null;

  @Prop({ type: Date, required: false, default: null })
  mqttCredentialsRotatedAt!: Date | null;

  /** 009 — reported installed ad-client release (from device). */
  @Prop({
    type: {
      versionIdentifier: { type: String, required: true },
      installedAt: { type: Date, required: true },
    },
    required: false,
    default: null,
  })
  currentRelease!: { versionIdentifier: string; installedAt: Date } | null;

  /** 009 — last update check outcome from device. */
  @Prop({
    type: {
      lastCheckAt: { type: Date, required: false, default: null },
      lastCheckResult: {
        type: String,
        enum: ['up_to_date', 'update_available', 'update_failed', 'unknown'],
        required: false,
        default: 'unknown',
      },
      lastError: { type: String, required: false, default: null },
    },
    required: false,
    default: null,
  })
  updateState!: {
    lastCheckAt: Date | null;
    lastCheckResult:
      | 'up_to_date'
      | 'update_available'
      | 'update_failed'
      | 'unknown';
    lastError: string | null;
  } | null;

  /** Present on persisted docs when `timestamps: true` (not declared with @Prop). */
  createdAt?: Date;
  updatedAt?: Date;
}

export const DeviceSchema = SchemaFactory.createForClass(Device);

/** Named indexes — must match `IndexEnsureService` / data-model expectations. */
DeviceSchema.index({ deviceId: 1 }, { unique: true, name: 'deviceId_1' });
DeviceSchema.index({ serialNumber: 1 }, { unique: true, name: 'serialNumber_1' });

DeviceSchema.index({ lastSeenAt: 1 });
DeviceSchema.index({ lifecycleState: 1, groupId: 1 });
DeviceSchema.index({ 'capabilityManifest.availableStorageGb': 1 });
DeviceSchema.index({ hardwareFingerprintHash: 1 });
