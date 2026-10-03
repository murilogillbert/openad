import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { MongodbModule } from '../infrastructure/mongodb/mongodb.module';
import { PostgresModule } from '../infrastructure/postgres/postgres.module';
import { AppLoggerModule } from '../infrastructure/logging/logger.module';
import { AssetStorageModule } from '../infrastructure/storage/storage.module';
import { HttpCorrelationInterceptor } from '../infrastructure/http/http-correlation.interceptor';
import { HttpExceptionFilter } from '../infrastructure/http/http-exception.filter';
import { AuthModule } from '../modules/auth/auth.module';
import { ConfigurationProfilesModule } from '../modules/configuration-profiles/configuration-profiles.module';
import { DeviceGroupsModule } from '../modules/device-groups/device-groups.module';
import { VehiclesModule } from '../modules/vehicles/vehicles.module';
import { DevicesModule } from '../modules/devices/devices.module';
import { CampaignsModule } from '../modules/campaigns/campaigns.module';
import { GeoZonesModule } from '../modules/geo-zones/geo-zones.module';
import { MetricsModule } from '../infrastructure/metrics/metrics.module';
import { QueuesModule } from '../infrastructure/queues/queues.module';
import { MqttModule } from '../infrastructure/mqtt/mqtt.module';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { FleetMonitorModule } from '../modules/fleet-monitor/fleet-monitor.module';
import { ImpressionsModule } from '../modules/impressions/impressions.module';
import { ReportingModule } from '../modules/reporting/reporting.module';
import { MediaIngestionModule } from '../modules/media-ingestion/media-ingestion.module';
import { ManifestModule } from '../modules/manifest/manifest.module';
import { PriorityCommandsModule } from '../modules/priority-commands/priority-commands.module';
import { SpatialLedgerModule } from '../modules/spatial-ledger/spatial-ledger.module';
import { AnalyticsModule } from '../modules/analytics/analytics.module';
import { AdvertiserModule } from '../modules/advertiser/advertiser.module';
import { ReleasesModule } from '../modules/releases/releases.module';
import { PlatformConfigModule } from '../modules/platform-config/platform-config.module';

/**
 * API test surface: auth + fleet + campaigns/geo (Bull/Redis/MQTT wired like production).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AppLoggerModule,
    AssetStorageModule,
    MongodbModule,
    // Global, mas `@Global()` so vale se o modulo estiver no grafo — sem isto o
    // `FederatedIdentityService` nao resolve o `PrismaService` nos testes.
    PostgresModule,
    RedisModule,
    MqttModule,
    MetricsModule,
    QueuesModule,
    AuthModule,
    VehiclesModule,
    DevicesModule,
    ConfigurationProfilesModule,
    DeviceGroupsModule,
    CampaignsModule,
    GeoZonesModule,
    FleetMonitorModule,
    ImpressionsModule,
    ReportingModule,
    MediaIngestionModule,
    ManifestModule,
    PriorityCommandsModule,
    SpatialLedgerModule,
    AnalyticsModule,
    AdvertiserModule,
    ReleasesModule,
    PlatformConfigModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: HttpCorrelationInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class TestAppModule {}
