import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export type RedisMessageHandler = (channel: string, message: string) => void;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly subClient: Redis;
  private readonly channelHandlers = new Map<string, RedisMessageHandler>();

  constructor(connectionUrl: string) {
    this.client = new Redis(connectionUrl, { maxRetriesPerRequest: null });
    // Subscriber connections cannot run arbitrary commands (e.g. INFO). ioredis
    // runs INFO during its ready check; disable it to avoid races with SUBSCRIBE.
    this.subClient = new Redis(connectionUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.subClient.on('message', (channel, message) => {
      this.channelHandlers.get(channel)?.(channel, message);
    });
  }

  onModuleDestroy(): void {
    this.client.disconnect();
    this.subClient.disconnect();
  }

  /** Low-level client for advanced Redis commands. */
  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  /** `XADD key id field value [field value ...]` */
  async xadd(
    key: string,
    id: string,
    ...fieldValues: string[]
  ): Promise<string | null> {
    return this.client.xadd(key, id, ...fieldValues);
  }

  /**
   * `XREADGROUP GROUP group consumer [BLOCK ms] STREAMS key id`
   * Use `streamId` `>` for undelivered new entries.
   */
  async xreadgroup(
    group: string,
    consumer: string,
    streamKey: string,
    streamId: string,
    blockMs?: number
  ): Promise<unknown> {
    if (blockMs !== undefined) {
      return this.client.xreadgroup(
        'GROUP',
        group,
        consumer,
        'BLOCK',
        blockMs,
        'STREAMS',
        streamKey,
        streamId
      );
    }
    return this.client.xreadgroup(
      'GROUP',
      group,
      consumer,
      'STREAMS',
      streamKey,
      streamId
    );
  }

  async xack(key: string, group: string, ...ids: string[]): Promise<number> {
    return this.client.xack(key, group, ...ids);
  }

  /** Create stream consumer group if missing (`MKSTREAM` when key absent). */
  async ensureConsumerGroup(
    streamKey: string,
    groupName: string
  ): Promise<void> {
    try {
      await this.client.xgroup(
        'CREATE',
        streamKey,
        groupName,
        '0',
        'MKSTREAM'
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('BUSYGROUP')) throw e;
    }
  }

  /**
   * `XREADGROUP GROUP group consumer COUNT n BLOCK ms STREAMS key >`
   */
  async xreadgroupBatch(
    group: string,
    consumer: string,
    streamKey: string,
    opts: { count: number; blockMs: number }
  ): Promise<unknown> {
    return this.client.call(
      'XREADGROUP',
      'GROUP',
      group,
      consumer,
      'COUNT',
      String(opts.count),
      'BLOCK',
      String(opts.blockMs),
      'STREAMS',
      streamKey,
      '>'
    ) as Promise<unknown>;
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  async subscribe(channel: string, handler: RedisMessageHandler): Promise<void> {
    this.channelHandlers.set(channel, handler);
    await this.subClient.subscribe(channel);
  }
}
