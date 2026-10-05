import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import {
  AdminDeviceDriverController,
  AdminDriversController,
} from './admin-drivers.controller';
import { DeviceDriverBindingService } from './device-driver-binding.service';
import { DriverDirectoryService } from './driver-directory.service';

/**
 * Motorista como consulta, nao como entidade.
 *
 * O openad nao guarda motorista: a fonte da verdade e `public.users` no Postgres do hub, e
 * este modulo apenas le o espelho. O que o openad guarda e o **vinculo**, em
 * `vehicles.driverId`, porque e dali que o repasse sai.
 *
 * `PrismaService` e global (`PostgresModule` e `@Global`), por isso nao aparece nos imports.
 */
@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => DevicesModule),
    forwardRef(() => VehiclesModule),
    PlatformConfigModule,
  ],
  controllers: [AdminDriversController, AdminDeviceDriverController],
  providers: [DriverDirectoryService, DeviceDriverBindingService],
  exports: [DriverDirectoryService],
})
export class DriversModule {}
