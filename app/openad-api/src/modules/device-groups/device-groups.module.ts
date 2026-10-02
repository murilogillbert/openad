import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigurationProfilesModule } from '../configuration-profiles/configuration-profiles.module';
import { DevicesModule } from '../devices/devices.module';
import { FleetMonitorModule } from '../fleet-monitor/fleet-monitor.module';
import { DeviceGroup, DeviceGroupSchema } from './device-group.schema';
import { DeviceGroupsRepository } from './device-groups.repository';
import { DeviceGroupsService } from './device-groups.service';
import { DeviceGroupsController } from './device-groups.controller';
import { AdminDeviceGroupsController } from './admin-device-groups.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceGroup.name, schema: DeviceGroupSchema },
    ]),
    DevicesModule,
    forwardRef(() => ConfigurationProfilesModule),
    forwardRef(() => FleetMonitorModule),
  ],
  controllers: [DeviceGroupsController, AdminDeviceGroupsController],
  providers: [DeviceGroupsRepository, DeviceGroupsService],
  exports: [DeviceGroupsRepository, DeviceGroupsService],
})
export class DeviceGroupsModule {}
