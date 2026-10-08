import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { GeoZonesModule } from '../geo-zones/geo-zones.module';
import { MediaIngestionModule } from '../media-ingestion/media-ingestion.module';
import { MonetizationModule } from '../monetization/monetization.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import {
  MediaAsset,
  MediaAssetSchema,
} from '../media-ingestion/schemas/media-asset.schema';
import { AdvertiserController } from './advertiser.controller';
import { AdvertiserCampaignsService } from './advertiser-campaigns.service';
import { AdvertiserInventoryService } from './advertiser-inventory.service';
import { AdvertiserOnboardingController } from './advertiser-onboarding.controller';
import { AdvertiserOnboardingService } from './advertiser-onboarding.service';

/**
 * Superficie do app do anunciante (`/api/v1/advertiser/*`).
 *
 * Nao expoe provider nenhum: e um modulo de borda, que compoe servicos existentes
 * (campanha, midia VFS, agregacao de analytics, zonas, veiculos) sob um escopo de dono. Nada
 * aqui deve ser importado por outro modulo — se for, a regra em questao pertence ao modulo de
 * dominio, nao a esta borda.
 *
 * `MongooseModule.forFeature` de `MediaAsset` e repetido aqui porque o `MediaIngestionModule`
 * exporta `MongooseModule`, mas depender da reexportacao deixaria este modulo quebrado por
 * ricochete se aquele parar de exportar. O registro e idempotente.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaAsset.name, schema: MediaAssetSchema },
    ]),
    AuthModule,
    CampaignsModule,
    MediaIngestionModule,
    GeoZonesModule,
    VehiclesModule,
    AnalyticsModule,
    PlatformConfigModule,
    MonetizationModule,
  ],
  /**
   * `AdvertiserOnboardingController` vem **antes** do `AdvertiserController`.
   *
   * Nao e preferencia de ordenacao: o Nest registra rotas na ordem dos controladores, e
   * `advertiser/onboarding` precisa ser avaliado antes de qualquer rota com parametro no
   * mesmo nivel. Hoje nao ha conflito (`AdvertiserController` so tem `campaigns/...` e
   * `inventory/...`), mas um `@Get(':algo')` acrescentado ali no futuro capturaria
   * `/advertiser/onboarding` e a adesao passaria a responder 401 sem nenhuma alteracao neste
   * arquivo.
   */
  controllers: [AdvertiserOnboardingController, AdvertiserController],
  providers: [
    AdvertiserCampaignsService,
    AdvertiserInventoryService,
    AdvertiserOnboardingService,
  ],
})
export class AdvertiserModule {}
