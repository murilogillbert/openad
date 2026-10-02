import { Test } from '@nestjs/testing';
import { ImpressionIngestionService } from './impression-ingestion.service';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { PinoLogger } from 'nestjs-pino';

describe('ImpressionIngestionService', () => {
  it('subscribes to openad/+/impressions with QoS 2', async () => {
    const mqtt = {
      subscribe: jest.fn(),
    };
    const redis = { xadd: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ImpressionIngestionService,
        { provide: MqttService, useValue: mqtt },
        { provide: RedisService, useValue: redis },
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    const svc = moduleRef.get(ImpressionIngestionService);
    await svc.onModuleInit();

    expect(mqtt.subscribe).toHaveBeenCalledWith(
      'openad/+/impressions',
      expect.any(Function),
      2
    );
  });
});
