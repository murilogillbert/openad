import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { RabbitmqManagementService } from './rabbitmq-management.service';
import {
  TABLET_MQTT_CLASSIC_CONFIGURE,
  TABLET_MQTT_CLASSIC_READ,
  TABLET_MQTT_CLASSIC_WRITE,
  tabletMqttReadRoutingKeyRegex,
  tabletMqttUsername,
  tabletMqttWriteRoutingKeyRegex,
} from './mqtt-topic-acl.util';

const DEFAULT_MQTT_EXCHANGE = 'amq.topic';

@Injectable()
export class RabbitmqTabletCredentialsService {
  private readonly logger = new Logger(RabbitmqTabletCredentialsService.name);

  constructor(
    private readonly management: RabbitmqManagementService
  ) {}

  provisioningEnabled(): boolean {
    return (process.env.RABBITMQ_PROVISION_DEVICE_MQTT_USERS ?? '') === 'true';
  }

  /**
   * Creates (or replaces) a RabbitMQ login for this tablet with topic ACLs on
   * `amq.topic` so it cannot publish/subscribe outside its namespace + shared broadcast.
   */
  async provision(deviceId: string): Promise<{ username: string; password: string }> {
    if (!this.management.isConfigured()) {
      throw new Error(
        'RabbitMQ Management API is not configured (set MQTT_MANAGEMENT_URL, MQTT_MANAGEMENT_USER, MQTT_MANAGEMENT_PASSWORD)'
      );
    }
    const username = tabletMqttUsername(deviceId);
    const password = randomBytes(24).toString('base64url');

    const exchange =
      (process.env.RABBITMQ_MQTT_EXCHANGE ?? '').trim() || DEFAULT_MQTT_EXCHANGE;

    await this.management.deleteUser(username);
    await this.management.putUser(username, password);

    const cfg =
      (process.env.RABBITMQ_TABLET_CLASSIC_CONFIGURE_REGEX ?? '').trim() ||
      TABLET_MQTT_CLASSIC_CONFIGURE;
    const w =
      (process.env.RABBITMQ_TABLET_CLASSIC_WRITE_REGEX ?? '').trim() ||
      TABLET_MQTT_CLASSIC_WRITE;
    const r =
      (process.env.RABBITMQ_TABLET_CLASSIC_READ_REGEX ?? '').trim() ||
      TABLET_MQTT_CLASSIC_READ;

    await this.management.setVhostPermissions(username, cfg, w, r);
    await this.management.setTopicPermissions(
      username,
      exchange,
      tabletMqttWriteRoutingKeyRegex(deviceId),
      tabletMqttReadRoutingKeyRegex(deviceId)
    );

    this.logger.log(
      `Provisioned RabbitMQ user for tablet ${username} (device ${deviceId})`
    );

    return { username, password };
  }

  /** Best-effort removal when a device is unbound / retired. */
  async deleteForDevice(deviceId: string): Promise<void> {
    if (!this.management.isConfigured()) {
      return;
    }
    const username = tabletMqttUsername(deviceId);
    try {
      await this.management.deleteUser(username);
      this.logger.log(`Deleted RabbitMQ user for tablet ${username}`);
    } catch (e: unknown) {
      this.logger.warn(
        `Failed to delete RabbitMQ tablet user ${username}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}
