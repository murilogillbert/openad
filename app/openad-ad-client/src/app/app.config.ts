import { isPlatformBrowser } from '@angular/common';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  APP_INITIALIZER,
  ApplicationConfig,
  importProvidersFrom,
  PLATFORM_ID,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { MqttModule } from './features/mqtt/mqtt.module';
import { AnalyticsModule } from './features/analytics/analytics.module';
import { PlaybackModule } from './features/playback/playback.module';
import { SyncModule } from './features/sync/sync.module';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { appRoutes } from './app.routes';
import { AdPlaybackService } from './services/ad-playback.service';
import { CapabilityManifestService } from './services/capability-manifest.service';
import { DeviceSessionService } from './services/device-session.service';
import { HealthReportingService } from './services/health-reporting.service';
import { MqttClientService } from './features/mqtt/services/mqtt-client.service';
import { PowerStateMonitorService } from './services/power-state-monitor.service';
import { DeepSleepService } from './services/watchdog/deep-sleep.service';
import { PlayerRestartScheduler } from './services/watchdog/player-restart.scheduler';
import { SafetyLoopService } from './services/watchdog/safety-loop.service';
import { TabletNativeIntegrationService } from './services/tablet-native-integration.service';
import { AppUpdateSchedulerService } from './services/app-update-scheduler.service';
import { GEO_FEATURE_PROVIDERS } from './features/geo/geo.providers';
import { SpatialRuntimeService } from './features/geo/services/spatial-runtime.service';
import { SyncSchedulerService } from './features/sync/services/sync-scheduler.service';
import { PlayBatchUploaderService } from './features/analytics/services/play-batch-uploader.service';

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(
      SyncModule,
      MqttModule,
      AnalyticsModule,
      PlaybackModule
    ),
    ...GEO_FEATURE_PROVIDERS,
    provideHttpClient(withFetch()),
    provideClientHydration(withEventReplay()),
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [PLATFORM_ID, TabletNativeIntegrationService],
      useFactory:
        (platformId: object, native: TabletNativeIntegrationService) => () => {
          if (!isPlatformBrowser(platformId)) {
            return Promise.resolve();
          }
          return native.initialize();
        },
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [SpatialRuntimeService],
      useFactory: (_spatial: SpatialRuntimeService) => () => Promise.resolve(),
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [
        PLATFORM_ID,
        DeviceSessionService,
        MqttClientService,
        CapabilityManifestService,
      ],
      useFactory:
        (
          platformId: object,
          session: DeviceSessionService,
          mqtt: MqttClientService,
          capability: CapabilityManifestService
        ) =>
        async () => {
          if (!isPlatformBrowser(platformId)) {
            return;
          }
          const id = await session.getStoredDeviceId();
          if (!id) {
            return;
          }
          await mqtt.attachDevice(id);
          try {
            await capability.report(id);
          } catch {
            /* manifest is best-effort on cold start */
          }
        },
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [
        PowerStateMonitorService,
        HealthReportingService,
        AdPlaybackService,
      ],
      useFactory:
        (
          power: PowerStateMonitorService,
          health: HealthReportingService,
          playback: AdPlaybackService
        ) =>
        async () => {
          // `AdPlaybackService` esta nas deps porque e ele quem assina os topicos MQTT de
          // config, schedule e comando no construtor. Nada o injeta no caminho de
          // reproducao, entao sem esta linha o tablet pareado nao receberia comando remoto.
          void playback;
          health.wireStorageFullFlag();
          await power.start();
        },
    },
    {
      // Sincronizacao de midia e envio de analytics. Os dois loops precisam de start()
      // explicito: antes dependiam de alguem injetar o servico, e ninguem injetava.
      provide: APP_INITIALIZER,
      multi: true,
      deps: [PLATFORM_ID, SyncSchedulerService, PlayBatchUploaderService],
      useFactory:
        (
          platformId: object,
          sync: SyncSchedulerService,
          uploader: PlayBatchUploaderService
        ) =>
        () => {
          if (!isPlatformBrowser(platformId)) {
            return;
          }
          sync.start();
          uploader.start();
        },
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [PLATFORM_ID, DeviceSessionService, AppUpdateSchedulerService],
      useFactory:
        (
          platformId: object,
          session: DeviceSessionService,
          scheduler: AppUpdateSchedulerService
        ) =>
        async () => {
          if (!isPlatformBrowser(platformId)) {
            return;
          }
          const id = await session.getStoredDeviceId();
          if (!id) {
            return;
          }
          scheduler.start();
        },
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [DeepSleepService, SafetyLoopService, PlayerRestartScheduler],
      useFactory:
        (
          deepSleep: DeepSleepService,
          safety: SafetyLoopService,
          playerRestart: PlayerRestartScheduler
        ) =>
        () => {
          deepSleep.start();
          safety.start();
          playerRestart.start();
        },
    },
  ],
};
