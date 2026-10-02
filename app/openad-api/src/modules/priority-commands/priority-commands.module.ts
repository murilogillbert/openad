import { Module } from '@nestjs/common';
import { PriorityCommandsGateway } from './priority-commands.gateway';

@Module({
  providers: [PriorityCommandsGateway],
  exports: [PriorityCommandsGateway],
})
export class PriorityCommandsModule {}
