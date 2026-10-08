import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { SchedulerLockService } from './scheduler-lock.service';

@Global()
@Module({
  providers: [
    {
      provide: RedisService,
      useFactory: () => {
        const url = (process.env.REDIS_URL ?? '').trim();
        if (!url) {
          throw new Error(
            'REDIS_URL is required. Start the API via `pnpm api:serve` (dotenvx) or export REDIS_URL before running.'
          );
        }
        return new RedisService(url);
      },
    },
    SchedulerLockService,
  ],
  /**
   * `@Global()`, então quem injeta `SchedulerLockService` não precisa importar nada — é o mesmo
   * tratamento que o `RedisService` já tinha, e o lock de agendador é usado em seis módulos
   * diferentes.
   */
  exports: [RedisService, SchedulerLockService],
})
export class RedisModule {}
