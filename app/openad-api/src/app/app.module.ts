import { Module } from '@nestjs/common';
import { validateEnv } from './env.validation';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../modules/auth/auth.module';
import { HttpCorrelationInterceptor } from '../infrastructure/http/http-correlation.interceptor';
import { HttpExceptionFilter } from '../infrastructure/http/http-exception.filter';
import { AppLoggerModule } from '../infrastructure/logging/logger.module';
import { MongodbModule } from '../infrastructure/mongodb/mongodb.module';
import { PostgresModule } from '../infrastructure/postgres/postgres.module';
import { MqttModule } from '../infrastructure/mqtt/mqtt.module';
import { QueuesModule } from '../infrastructure/queues/queues.module';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { HealthModule } from '../infrastructure/health/health.module';
import { MetricsModule } from '../infrastructure/metrics/metrics.module';
import { ConfigurationProfilesModule } from '../modules/configuration-profiles/configuration-profiles.module';
import { DeviceGroupsModule } from '../modules/device-groups/device-groups.module';
import { DevicesModule } from '../modules/devices/devices.module';
import { VehiclesModule } from '../modules/vehicles/vehicles.module';
import { CampaignsModule } from '../modules/campaigns/campaigns.module';
import { GeoZonesModule } from '../modules/geo-zones/geo-zones.module';
import { FleetMonitorModule } from '../modules/fleet-monitor/fleet-monitor.module';
import { ImpressionsModule } from '../modules/impressions/impressions.module';
import { ReportingModule } from '../modules/reporting/reporting.module';
import { MediaIngestionModule } from '../modules/media-ingestion/media-ingestion.module';
import { ManifestModule } from '../modules/manifest/manifest.module';
import { PriorityCommandsModule } from '../modules/priority-commands/priority-commands.module';
import { SpatialLedgerModule } from '../modules/spatial-ledger/spatial-ledger.module';
import { AnalyticsModule } from '../modules/analytics/analytics.module';
import { AdvertiserModule } from '../modules/advertiser/advertiser.module';
import { ModerationModule } from '../modules/moderation/moderation.module';
import { InternalModule } from '../modules/internal/internal.module';
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { ReleasesModule } from '../modules/releases/releases.module';
import { AssetStorageModule } from '../infrastructure/storage/storage.module';
import { PlatformConfigModule } from '../modules/platform-config/platform-config.module';

const testRun = process.env.NODE_ENV === 'test';

@Module({
  imports: [
    // `dotenvx` (scripts/with-monorepo-env.sh) is responsible for populating process.env.
    // Validate once on startup; do not use Nest ConfigModule at runtime.
    (() => {
      validateEnv(process.env as unknown as Record<string, unknown>);
      return ScheduleModule.forRoot();
    })(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: testRun ? 100_000 : 800,
      },
      /**
       * Named throttlers apply to every route unless @SkipThrottle(name) is set.
       * Real limits belong on @Throttle({ name: { limit } }) for that handler only.
       * Baselines here must be high so portal polling (dashboard, fleet, etc.) is not capped at 5–10/min.
       */
      {
        name: 'login',
        ttl: 60_000,
        limit: testRun ? 100_000 : 1_000_000,
      },
      {
        name: 'upload',
        ttl: 60_000,
        limit: testRun ? 100_000 : 1_000_000,
      },
      {
        name: 'reports',
        ttl: 60_000,
        limit: testRun ? 100_000 : 1_000_000,
      },
      {
        name: 'mediaUpload',
        ttl: 60_000,
        limit: testRun ? 100_000 : 1_000_000,
      },
      {
        name: 'manifestDevice',
        ttl: 60_000,
        limit: testRun ? 100_000 : 1_000_000,
      },
    ]),
    AssetStorageModule,
    AppLoggerModule,
    MongodbModule,
    PostgresModule,
    RedisModule,
    MqttModule,
    QueuesModule,
    HealthModule,
    MetricsModule,
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
    ModerationModule,
    InternalModule,
    DashboardModule,
    ReleasesModule,
    PlatformConfigModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: HttpCorrelationInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
