import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MongooseHealthIndicator } from '@nestjs/terminus';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';
import { MqttBrokerHealthIndicator } from './mqtt-broker-health.indicator';
import { RedisPingHealthIndicator } from './redis-health.indicator';

@Module({
  imports: [TerminusModule, MongooseModule, RedisModule],
  controllers: [HealthController],
  providers: [
    MongooseHealthIndicator,
    MqttBrokerHealthIndicator,
    RedisPingHealthIndicator,
  ],
})
export class HealthModule {}
