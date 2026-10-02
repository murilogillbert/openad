import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetStorageModule } from '../../infrastructure/storage/storage.module';
import { RabbitmqModule } from '../../infrastructure/rabbitmq/rabbitmq.module';
import { AuthModule } from '../auth/auth.module';
import { FleetMonitorModule } from '../fleet-monitor/fleet-monitor.module';
import { DeviceLifecycleEventRepository } from './device-lifecycle-event.repository';
import { RetiredDeviceRegistryRepository } from './retired-device-registry.repository';
import { DeviceStateMachineService } from './device-state-machine.service';
import { RetiredDeviceGuard } from './retired-device-guard';
import { AdminDevicesController } from './admin-devices.controller';
import { AdminDevicesPairingController } from './admin-devices-pairing.controller';
import { DeviceUnbindService } from './device-unbind.service';
import { DeviceJwtAuthGuard } from './device-jwt-auth.guard';
import { DevicesController } from './devices.controller';
import { PairingController } from './pairing.controller';
import { PairingAuditService } from './pairing-audit.service';
import { PairingService } from './pairing.service';
import { ScreenshotUploadService } from './screenshot-upload.service';
import { Device, DeviceSchema } from './devices.schema';
import {
  PairingAttemptLogRecord,
  PairingAttemptLogSchema,
} from './schemas/pairing-attempt-log.schema';
import {
  PairingRequestRecord,
  PairingRequestSchema,
} from './schemas/pairing-request.schema';
import {
  PairingSecretRecord,
  PairingSecretSchema,
} from './schemas/pairing-secret.schema';
import {
  DeviceLifecycleEvent,
  DeviceLifecycleEventSchema,
} from './device-lifecycle-event.schema';
import {
  RetiredDeviceRegistry,
  RetiredDeviceRegistrySchema,
} from './retired-device-registry.schema';
import { DevicesListService } from './devices-list.service';
import { DevicesRepository } from './devices.repository';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { ManifestDeltaService } from './manifest-delta.service';
import { ManifestVersionsRepository } from './manifest-versions.repository';
import {
  ManifestVersionRecord,
  ManifestVersionSchema,
} from './schemas/manifest-version.schema';

@Module({
  imports: [
    AssetStorageModule,
    RabbitmqModule,
    MongooseModule.forFeature([
      { name: Device.name, schema: DeviceSchema },
      { name: DeviceLifecycleEvent.name, schema: DeviceLifecycleEventSchema },
      { name: RetiredDeviceRegistry.name, schema: RetiredDeviceRegistrySchema },
      { name: PairingRequestRecord.name, schema: PairingRequestSchema },
      { name: PairingSecretRecord.name, schema: PairingSecretSchema },
      { name: PairingAttemptLogRecord.name, schema: PairingAttemptLogSchema },
      { name: ManifestVersionRecord.name, schema: ManifestVersionSchema },
    ]),
    forwardRef(() => VehiclesModule),
    forwardRef(() => AuthModule),
    forwardRef(() => FleetMonitorModule),
  ],
  controllers: [
    DevicesController,
    PairingController,
    AdminDevicesController,
    AdminDevicesPairingController,
  ],
  providers: [
    DevicesRepository,
    DevicesListService,
    DeviceLifecycleEventRepository,
    RetiredDeviceRegistryRepository,
    DeviceStateMachineService,
    RetiredDeviceGuard,
    DeviceJwtAuthGuard,
    DeviceUnbindService,
    PairingService,
    PairingAuditService,
    ScreenshotUploadService,
    ManifestVersionsRepository,
    ManifestDeltaService,
  ],
  exports: [
    DevicesRepository,
    MongooseModule,
    DeviceStateMachineService,
    RetiredDeviceGuard,
    ManifestVersionsRepository,
    DeviceJwtAuthGuard,
  ],
})
export class DevicesModule {}
