import { Module } from '@nestjs/common';
import { RabbitmqManagementService } from './rabbitmq-management.service';
import { RabbitmqTabletCredentialsService } from './rabbitmq-tablet-credentials.service';

@Module({
  providers: [RabbitmqManagementService, RabbitmqTabletCredentialsService],
  exports: [RabbitmqTabletCredentialsService, RabbitmqManagementService],
})
export class RabbitmqModule {}
