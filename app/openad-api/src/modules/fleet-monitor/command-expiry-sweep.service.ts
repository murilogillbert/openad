import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { SchedulerLockService } from '../../infrastructure/redis/scheduler-lock.service';
import { RemoteCommandsRepository } from './remote-commands.repository';

/**
 * Marks commands whose TTL has passed as `Expired` (FR-012 / spec edge cases).
 */
@Injectable()
export class CommandExpirySweepService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly commands: RemoteCommandsRepository,
    private readonly lock: SchedulerLockService
  ) {
    this.logger.setContext(CommandExpirySweepService.name);
  }

  /**
   * Lock de 45 s para uma varredura de minuto: cobre a sobreposição entre réplicas sem
   * atravessar a execução seguinte. Ver `SchedulerLockService` para por que o lock é economia e
   * não correção — marcar expirado duas vezes é idempotente, o que se evita é o trabalho.
   */
  @Cron('15 * * * * *')
  async sweep(): Promise<void> {
    await this.lock.comLock('openad:cron:command-expiry', 45_000, async () => {
      const n = await this.commands.markExpired(new Date());
      if (n > 0) {
        this.logger.info({ expired: n, event: 'command.expired_sweep' }, 'marked expired commands');
      }
    });
  }
}
