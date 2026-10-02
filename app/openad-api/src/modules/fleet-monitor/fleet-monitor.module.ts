import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetStorageModule } from '../../infrastructure/storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { DevicesModule } from '../devices/devices.module';
import { GeoZonesModule } from '../geo-zones/geo-zones.module';
import { ImpressionsModule } from '../impressions/impressions.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import {
  RemoteCommandRecord,
  RemoteCommandSchema,
} from './remote-command.schema';
import {
  NotificationRecord,
  NotificationSchema,
} from './notification.schema';
import { RemoteCommandsRepository } from './remote-commands.repository';
import { NotificationService } from './notification.service';
import { TelemetryIngestorService } from './telemetry-ingestor.service';
import { HeartbeatMonitorService } from './heartbeat-monitor.service';
import { RemoteCommandService } from './remote-command.service';
import { CommandDispatchProcessor } from './command-dispatch.processor';
import { CommandAckHandler } from './command-ack.handler';
import { FleetQueryService } from './fleet-query.service';
import { FleetMapController } from './fleet-map.controller';
import { FleetMapService } from './fleet-map.service';
import { FleetMonitorController } from './fleet-monitor.controller';
import { FleetGateway } from './fleet-gateway';
import { OperationsKpisService } from './operations-kpis.service';
import { HealthThresholdEvaluatorService } from './health-threshold-evaluator.service';
import { AdminDevicesCommandsController } from './admin-devices-commands.controller';
import { CommandExpirySweepService } from './command-expiry-sweep.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DashboardController } from '../dashboard/dashboard.controller';
import { PlatformConfigModule } from '../platform-config/platform-config.module';

@Module({
  imports: [
    AssetStorageModule,
    AuthModule,
    GeoZonesModule,
    ImpressionsModule,
    forwardRef(() => CampaignsModule),
    forwardRef(() => DevicesModule),
    forwardRef(() => VehiclesModule),
    forwardRef(() => DashboardModule),
    PlatformConfigModule,
    MongooseModule.forFeature([
      { name: RemoteCommandRecord.name, schema: RemoteCommandSchema },
      { name: NotificationRecord.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [
    FleetMonitorController,
    FleetMapController,
    AdminDevicesCommandsController,
    DashboardController,
  ],
  providers: [
    RemoteCommandsRepository,
    NotificationService,
    HealthThresholdEvaluatorService,
    TelemetryIngestorService,
    HeartbeatMonitorService,
    RemoteCommandService,
    CommandDispatchProcessor,
    CommandAckHandler,
    CommandExpirySweepService,
    FleetQueryService,
    FleetMapService,
    FleetGateway,
    OperationsKpisService,
  ],
  exports: [
    NotificationService,
    FleetGateway,
    RemoteCommandsRepository,
    RemoteCommandService,
    FleetQueryService,
  ],
})
export class FleetMonitorModule {}
