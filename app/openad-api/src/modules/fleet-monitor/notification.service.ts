import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from '../../infrastructure/redis/redis.service';
import {
  NotificationRecord,
  NotificationDocument,
} from './notification.schema';

const DASHBOARD_CHANNEL = 'pubsub:dashboard';

@Injectable()
export class NotificationService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly redis: RedisService,
    @InjectModel(NotificationRecord.name)
    private readonly notificationModel: Model<NotificationDocument>
  ) {
    this.logger.setContext(NotificationService.name);
  }

  async alertAdmins(
    deviceId: string,
    title: string,
    body: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const notificationId = randomUUID();
    await this.notificationModel.create({
      notificationId,
      type: 'fleet_alert',
      title,
      body,
      read: false,
      metadata: { deviceId, ...metadata },
    });

    const payload = JSON.stringify({
      kind: 'notification',
      notificationId,
      title,
      body,
      deviceId,
      at: new Date().toISOString(),
    });
    await this.redis.publish(DASHBOARD_CHANNEL, payload);
    this.logger.warn({ deviceId, notificationId, event: 'fleet.alert' }, body);
  }

  async broadcastDashboard(event: Record<string, unknown>): Promise<void> {
    await this.redis.publish(
      DASHBOARD_CHANNEL,
      JSON.stringify({ kind: 'fleet_event', ...event, at: new Date().toISOString() })
    );
  }
}
