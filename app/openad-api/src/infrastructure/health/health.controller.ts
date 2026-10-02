import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { MqttBrokerHealthIndicator } from './mqtt-broker-health.indicator';
import { RedisPingHealthIndicator } from './redis-health.indicator';

@SkipThrottle()
@Controller('api/health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly redis: RedisPingHealthIndicator,
    private readonly mqttBroker: MqttBrokerHealthIndicator
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.mongoose.pingCheck('mongodb'),
      () => this.redis.isHealthy('redis'),
      () => this.mqttBroker.isHealthy('mqtt'),
    ]);
  }
}
