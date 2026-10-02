import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

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
  ],
  exports: [RedisService],
})
export class RedisModule {}
