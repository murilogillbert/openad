import { Injectable, Logger } from '@nestjs/common';
import {
  TABLET_MQTT_CLASSIC_CONFIGURE,
  TABLET_MQTT_CLASSIC_READ,
  TABLET_MQTT_CLASSIC_WRITE,
} from './mqtt-topic-acl.util';
import { mqttLoginFromEnv } from './mqtt-env-credentials.util';
import { RabbitmqManagementService } from './rabbitmq-management.service';

const DEFAULT_MQTT_EXCHANGE = 'amq.topic';

/** Topic ACL: backend may publish/subscribe any routing key on `amq.topic` (openad.*, devices.*, …). */
const API_TOPIC_READ_WRITE = '^.*$';

export type RabbitmqApiMqttUserSeedResult =
  | {
      status: 'skipped';
      reason:
        | 'management_not_configured'
        | 'no_mqtt_credentials'
        | 'disabled_by_env'
        | 'same_as_management_user';
    }
  | { status: 'provisioned'; username: string };

/**
 * Ensures the RabbitMQ MQTT user referenced by `MQTT_URL` (or `MQTT_USERNAME` / `MQTT_PASSWORD`)
 * exists with permissions matching the API broker usage. Idempotent.
 */
@Injectable()
export class RabbitmqApiMqttUserSeedService {
  private readonly logger = new Logger(RabbitmqApiMqttUserSeedService.name);

  constructor(
    private readonly management: RabbitmqManagementService
  ) {}

  async ensureApiMqttUser(): Promise<RabbitmqApiMqttUserSeedResult> {
    if ((process.env.RABBITMQ_SEED_API_MQTT_USER ?? '') === 'false') {
      this.logger.log('Skipped (RABBITMQ_SEED_API_MQTT_USER=false)');
      return { status: 'skipped', reason: 'disabled_by_env' };
    }

    if (!this.management.isConfigured()) {
      this.logger.log(
        'Skipped RabbitMQ API MQTT user: management API not configured (MQTT_MANAGEMENT_URL, MQTT_MANAGEMENT_USER, MQTT_MANAGEMENT_PASSWORD)'
      );
      return { status: 'skipped', reason: 'management_not_configured' };
    }

    const login = mqttLoginFromEnv();
    if (!login) {
      this.logger.warn(
        'Skipped RabbitMQ API MQTT user: set MQTT_URL with credentials or MQTT_USERNAME + MQTT_PASSWORD'
      );
      return { status: 'skipped', reason: 'no_mqtt_credentials' };
    }

    const exchange =
      (process.env.RABBITMQ_MQTT_EXCHANGE ?? '').trim() || DEFAULT_MQTT_EXCHANGE;

    const mgmtUser = (process.env.MQTT_MANAGEMENT_USER ?? '').trim();
    const sameAsMgmt = mgmtUser !== '' && login.username === mgmtUser;
    if (sameAsMgmt) {
      // Same account as management HTTP login: Docker's RABBITMQ_DEFAULT_USER already has
      // full vhost access. putUser / set_permissions / topic-permissions still require an
      // *administrator* session; if that tag was stripped (e.g. legacy seed sent tags: ''),
      // every call returns 401 "Not management user" even though MQTT_PASSWORD "matches".
      this.logger.log(
        `Skipped RabbitMQ seed writes: API MQTT user "${login.username}" is MQTT_MANAGEMENT_USER (broker default). ` +
          `No management API calls needed for local Docker. If pairing/health get 401, run: ` +
          `rabbitmqctl set_user_tags ${login.username} administrator`
      );
      return { status: 'skipped', reason: 'same_as_management_user' };
    }

    await this.management.putUser(login.username, login.password);
    await this.management.setVhostPermissions(
      login.username,
      TABLET_MQTT_CLASSIC_CONFIGURE,
      TABLET_MQTT_CLASSIC_WRITE,
      TABLET_MQTT_CLASSIC_READ
    );
    await this.management.setTopicPermissions(
      login.username,
      exchange,
      API_TOPIC_READ_WRITE,
      API_TOPIC_READ_WRITE
    );

    this.logger.log(`Provisioned RabbitMQ MQTT user for API: ${login.username}`);
    return { status: 'provisioned', username: login.username };
  }
}
