import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PostgresModule } from '../../infrastructure/postgres/postgres.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import {
  MediaAsset,
  MediaAssetSchema,
} from '../media-ingestion/schemas/media-asset.schema';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { CreditCycleJob } from './credit-cycle.job';
import { CreditCycleService } from './credit-cycle.service';
import { CreditLedgerService } from './credit-ledger.service';
import { CreditPurchaseService } from './credit-purchase.service';
import { PixChargeClient } from './pix-charge.client';

/**
 * Dinheiro do anunciante: saldo, reserva por ciclo e débito da captura.
 *
 * Módulo próprio, e não parte do de analytics ou do de campanhas, porque os dois dependem
 * dele: a elegibilidade do manifesto precisa saber se há reserva aberta, e o processador de
 * analytics precisa debitar a captura. Pendurar isso em qualquer um dos dois criaria uma
 * dependência circular entre eles.
 *
 * `forwardRef` em `CampaignsModule` porque o ciclo lê a campanha para dimensionar a reserva, e
 * o módulo de campanhas já participa de outros ciclos de importação no projeto.
 */
@Module({
  imports: [
    PostgresModule,
    MongooseModule.forFeature([{ name: MediaAsset.name, schema: MediaAssetSchema }]),
    forwardRef(() => CampaignsModule),
    PlatformConfigModule,
  ],
  providers: [
    CreditLedgerService,
    CreditCycleService,
    CreditCycleJob,
    CreditPurchaseService,
    PixChargeClient,
  ],
  // O job não é exportado: ninguém o chama, o cron o dispara. Exportá-lo convidaria outro
  // módulo a invocar o ciclo por fora do lock.
  //
  // `PixChargeClient` também não: ele é detalhe de como a compra fala com o hub. Quem precisar
  // de cobrança passa pelo `CreditPurchaseService`, que grava a compra antes de pedi-la.
  exports: [CreditLedgerService, CreditCycleService, CreditPurchaseService],
})
export class MonetizationModule {}
