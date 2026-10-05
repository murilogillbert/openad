import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlayRecord, PlayRecordSchema } from '../analytics/schemas/play-record.schema';
import { Vehicle, VehicleSchema } from './vehicles.schema';
import {
  VehicleBindingAuditEvent,
  VehicleBindingAuditSchema,
} from './vehicle-binding-audit.schema';
import {
  FleetStatusRecord,
  FleetStatusSchema,
} from './fleet-status.schema';
import { VehiclesRepository } from './vehicles.repository';
import { FleetStatusRepository } from './fleet-status.repository';
import { VehiclesQueryService } from './vehicles-query.service';
import { VehiclesUpdateService } from './vehicles-update.service';
import { VehicleDecommissionService } from './vehicle-decommission.service';
import { FleetDomainEventsService } from './fleet-domain-events.service';
import { VehiclesController } from './vehicles.controller';
import { VehiclesCreateService } from './vehicles-create.service';
import { VehicleBindingAuditRepository } from './vehicle-binding-audit.repository';
import { VehicleBindingAuditService } from './vehicle-binding-audit.service';
import { VehicleBindingAuditQueryService } from './vehicle-binding-audit-query.service';
import { VehicleBindingService } from './vehicle-binding.service';
import { DevicesModule } from '../devices/devices.module';
import { FleetMonitorModule } from '../fleet-monitor/fleet-monitor.module';
import { ScheduleRulesModule } from '../schedule-rules/schedule-rules.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Vehicle.name, schema: VehicleSchema },
      { name: PlayRecord.name, schema: PlayRecordSchema },
      { name: FleetStatusRecord.name, schema: FleetStatusSchema },
      {
        name: VehicleBindingAuditEvent.name,
        schema: VehicleBindingAuditSchema,
      },
    ]),
    forwardRef(() => DevicesModule),
    forwardRef(() => FleetMonitorModule),
    forwardRef(() => ScheduleRulesModule),
  ],
  controllers: [VehiclesController],
  providers: [
    VehiclesRepository,
    FleetStatusRepository,
    VehicleBindingAuditRepository,
    VehicleBindingAuditService,
    VehicleBindingAuditQueryService,
    VehicleBindingService,
    VehiclesQueryService,
    VehiclesCreateService,
    VehiclesUpdateService,
    VehicleDecommissionService,
    FleetDomainEventsService,
  ],
  exports: [
    VehiclesRepository,
    FleetStatusRepository,
    FleetDomainEventsService,
    VehiclesQueryService,
    // Exportado para o `DriversModule`: vinculo de motorista grava trilha na mesma colecao
    // de auditoria de binding, porque e a mesma pergunta — quem estava ligado a este
    // veiculo e quando.
    VehicleBindingAuditService,
    MongooseModule,
  ],
})
export class VehiclesModule {}
