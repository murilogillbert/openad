import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { RemoteCommandsRepository } from './remote-commands.repository';

/**
 * Marks commands whose TTL has passed as `Expired` (FR-012 / spec edge cases).
 */
@Injectable()
export class CommandExpirySweepService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly commands: RemoteCommandsRepository
  ) {
    this.logger.setContext(CommandExpirySweepService.name);
  }

  @Cron('15 * * * * *')
  async sweep(): Promise<void> {
    const n = await this.commands.markExpired(new Date());
    if (n > 0) {
      this.logger.info({ expired: n, event: 'command.expired_sweep' }, 'marked expired commands');
    }
  }
}
