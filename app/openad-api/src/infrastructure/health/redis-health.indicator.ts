import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisPingHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.getClient().ping();
      const ok = pong === 'PONG';
      if (!ok) {
        throw new HealthCheckError(
          'redis ping failed',
          this.getStatus(key, false)
        );
      }
      return this.getStatus(key, true);
    } catch (e) {
      throw new HealthCheckError(
        'redis ping failed',
        this.getStatus(key, false, {
          message: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }
}
