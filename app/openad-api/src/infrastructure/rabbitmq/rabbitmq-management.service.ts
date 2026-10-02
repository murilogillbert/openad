import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * HTTP client for RabbitMQ Management API (user + vhost + topic permissions).
 */
@Injectable()
export class RabbitmqManagementService implements OnModuleInit {
  private readonly logger = new Logger(RabbitmqManagementService.name);
  private baseUrl = '';
  private user = '';
  private pass = '';

  onModuleInit(): void {
    this.baseUrl = (process.env.MQTT_MANAGEMENT_URL ?? '').trim();
    this.user = (process.env.MQTT_MANAGEMENT_USER ?? '').trim();
    this.pass = (process.env.MQTT_MANAGEMENT_PASSWORD ?? '').trim();
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.user && this.pass);
  }

  private vhostSegment(): string {
    const v = (process.env.RABBITMQ_MQTT_VHOST ?? '/').trim() || '/';
    return encodeURIComponent(v);
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.user}:${this.pass}`).toString('base64')}`;
  }

  private managementAuthFailureHint(status: number, body: string): string {
    if (status !== 401 || !body.includes('not_authorised')) {
      return '';
    }
    return (
      ' The management HTTP user must have the RabbitMQ administrator tag. ' +
      'If a past tool cleared user tags, run: rabbitmqctl set_user_tags <user> administrator ' +
      '(e.g. docker exec openad-rabbitmq rabbitmqctl set_user_tags openad administrator). ' +
      'Also verify MQTT_MANAGEMENT_USER/PASSWORD in app/openad-api match docker RABBITMQ_DEFAULT_* .'
    );
  }

  private async req(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;
    return fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async deleteUser(username: string): Promise<void> {
    const path = `/api/users/${encodeURIComponent(username)}`;
    const res = await this.req('DELETE', path);
    if (res.status === 204 || res.status === 404) {
      return;
    }
    const text = await res.text();
    throw new Error(
      `RabbitMQ delete user ${username}: ${res.status} ${text.slice(0, 500)}`
    );
  }

  /**
   * Create or update a user password. Do not send `tags` unless you intend to replace them:
   * sending `tags: ''` strips the `administrator` tag from the broker default user and breaks
   * the management API with 401 `Not management user`.
   */
  async putUser(username: string, password: string): Promise<void> {
    const res = await this.req('PUT', `/api/users/${encodeURIComponent(username)}`, {
      password,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `RabbitMQ put user ${username}: ${res.status} ${text.slice(0, 500)}${this.managementAuthFailureHint(res.status, text)}`
      );
    }
  }

  async setVhostPermissions(
    username: string,
    configure: string,
    write: string,
    read: string
  ): Promise<void> {
    const v = this.vhostSegment();
    const res = await this.req(
      'PUT',
      `/api/permissions/${v}/${encodeURIComponent(username)}`,
      { configure, write, read }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `RabbitMQ set_permissions ${username}: ${res.status} ${text.slice(0, 500)}${this.managementAuthFailureHint(res.status, text)}`
      );
    }
  }

  async setTopicPermissions(
    username: string,
    exchange: string,
    write: string,
    read: string
  ): Promise<void> {
    const v = this.vhostSegment();
    const res = await this.req(
      'PUT',
      `/api/topic-permissions/${v}/${encodeURIComponent(username)}`,
      { exchange, write, read }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `RabbitMQ set_topic_permissions ${username}: ${res.status} ${text.slice(0, 500)}${this.managementAuthFailureHint(res.status, text)}`
      );
    }
  }
}
