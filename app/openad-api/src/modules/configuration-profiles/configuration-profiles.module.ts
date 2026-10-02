import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DevicesModule } from '../devices/devices.module';
import { DeviceGroupsModule } from '../device-groups/device-groups.module';
import { FleetMonitorModule } from '../fleet-monitor/fleet-monitor.module';
import {
  ConfigurationProfile,
  ConfigurationProfileSchema,
} from './configuration-profile.schema';
import { ConfigurationProfilesRepository } from './configuration-profiles.repository';
import { ConfigurationProfilesService } from './configuration-profiles.service';
import { ConfigurationProfilesController } from './configuration-profiles.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConfigurationProfile.name, schema: ConfigurationProfileSchema },
    ]),
    DevicesModule,
    forwardRef(() => DeviceGroupsModule),
    forwardRef(() => FleetMonitorModule),
  ],
  controllers: [ConfigurationProfilesController],
  providers: [ConfigurationProfilesRepository, ConfigurationProfilesService],
  exports: [ConfigurationProfilesRepository, ConfigurationProfilesService],
})
export class ConfigurationProfilesModule {}
