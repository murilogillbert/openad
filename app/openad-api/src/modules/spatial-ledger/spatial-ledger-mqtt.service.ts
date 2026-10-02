import { Injectable, OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { SpatialLedgerIngestService } from './spatial-ledger-ingest.service';

@Injectable()
export class SpatialLedgerMqttService implements OnModuleInit {
  constructor(
    private readonly mqtt: MqttService,
    private readonly ingest: SpatialLedgerIngestService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(SpatialLedgerMqttService.name);
  }

  onModuleInit(): void {
    this.mqtt.subscribe('openad/+/spatial', (topic, payload) => {
      void this.onMessage(topic, payload);
    });
    this.logger.info({}, 'Subscribed to openad/+/spatial');
  }

  private async onMessage(_topic: string, payload: Buffer): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn({ event: 'spatial_ledger.parse_error' }, 'invalid JSON');
      return;
    }
    await this.ingest.ingestBatch(json, null);
  }
}
