import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type {
  IssueCommandRequest,
  RemoteCommandListResponse,
  RemoteCommandType,
} from '@openad/api-contracts';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { DevicesRepository } from '../devices/devices.repository';
import { RemoteCommandsRepository } from './remote-commands.repository';

export const COMMAND_DISPATCH_JOB = 'dispatch';

const COMMAND_STREAM = 'stream:commands';

const DEFAULT_TTL_MS: Record<RemoteCommandType, number> = {
  GET_SCREENSHOT: 60_000,
  CLEAR_CACHE: 86_400_000,
  UPGRADE_APP: 72 * 3_600_000,
  SET_VOLUME: 3_600_000,
  SET_BRIGHTNESS: 3_600_000,
  EMERGENCY_SYNC: 3_600_000,
  TEMP_DISABLE_KIOSK: 3_600_000,
  RESTART: 7 * 86_400_000,
  SYNC_SCHEDULE: 7 * 86_400_000,
  CUSTOM: 86_400_000,
};

async function assertApkUrlReachable(url: string): Promise<void> {
  const run = async (method: 'HEAD' | 'GET'): Promise<boolean> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8_000);
    try {
      const init: RequestInit = {
        method,
        signal: controller.signal,
        redirect: 'manual',
      };
      if (method === 'GET') {
        init.headers = { Range: 'bytes=0-0' };
      }
      const res = await fetch(url, init);
      return res.status < 400 || res.status === 405;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  };

  if (await run('HEAD')) {
    return;
  }
  if (await run('GET')) {
    return;
  }
  throw new BadRequestException({
    code: 'APK_URL_UNREACHABLE',
    message: `Cannot reach APK URL: ${url}`,
  });
}

@Injectable()
export class RemoteCommandService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly devices: DevicesRepository,
    private readonly commands: RemoteCommandsRepository,
    private readonly storage: AssetStorageService,
    private readonly redis: RedisService,
    @InjectQueue('command-dispatch') private readonly dispatchQueue: Queue
  ) {
    this.logger.setContext(RemoteCommandService.name);
  }

  private publicApiBase(): string {
    const explicit = (process.env.PUBLIC_API_BASE_URL ?? '').trim();
    if (explicit) {
      return explicit.replace(/\/$/, '');
    }
    const port = (process.env.PORT ?? '3000').trim() || '3000';
    return `http://127.0.0.1:${port}`;
  }

  private buildScreenshotUploadUrl(deviceId: string, commandId: string): string {
    const base = this.publicApiBase();
    return `${base}/api/v1/devices/${encodeURIComponent(deviceId)}/commands/screenshots/${encodeURIComponent(commandId)}`;
  }

  private resolveTtlMs(
    type: RemoteCommandType,
    payload: Record<string, unknown> | null
  ): number {
    const raw = payload?.['ttlSeconds'];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw * 1000);
    }
    return DEFAULT_TTL_MS[type];
  }

  private async buildStoredPayload(
    deviceId: string,
    commandId: string,
    type: RemoteCommandType,
    issuedAt: Date,
    bodyPayload: Record<string, unknown> | null
  ): Promise<Record<string, unknown> | null> {
    if (type === 'GET_SCREENSHOT') {
      const ttl = this.resolveTtlMs(type, bodyPayload);
      const deadlineAt = new Date(issuedAt.getTime() + Math.min(ttl, 60_000));
      return {
        ...(bodyPayload ?? {}),
        uploadUrl: this.buildScreenshotUploadUrl(deviceId, commandId),
        deadlineAt: deadlineAt.toISOString(),
      };
    }
    return bodyPayload;
  }

  private validateCommandBody(type: RemoteCommandType, payload: Record<string, unknown> | null): void {
    if (type === 'UPGRADE_APP') {
      const url = payload?.['apkUrl'];
      if (typeof url !== 'string' || !url.startsWith('http')) {
        throw new BadRequestException({
          code: 'INVALID_PAYLOAD',
          message: 'UPGRADE_APP requires payload.apkUrl (https URL)',
        });
      }
    }
    if (type === 'SET_VOLUME' || type === 'SET_BRIGHTNESS') {
      const level = payload?.['level'];
      if (typeof level !== 'number' || level < 0 || level > 100) {
        throw new BadRequestException({
          code: 'INVALID_PAYLOAD',
          message: `${type} requires payload.level between 0 and 100`,
        });
      }
    }
    if (type === 'TEMP_DISABLE_KIOSK') {
      const raw = payload?.['durationSeconds'];
      if (raw == null) {
        return;
      }
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 30 || raw > 3600) {
        throw new BadRequestException({
          code: 'INVALID_PAYLOAD',
          message: 'TEMP_DISABLE_KIOSK optional payload.durationSeconds must be between 30 and 3600',
        });
      }
    }
  }

  async issue(
    deviceId: string,
    body: IssueCommandRequest,
    issuedByUserId: string | null
  ): Promise<{ commandId: string; status: 'queued' | 'Pending'; expiresAt: string }> {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', message: deviceId });
    }
    if (!device.boundVehicleId) {
      throw new BadRequestException({
        code: 'DEVICE_UNBOUND',
        message: 'Device is not bound to a vehicle',
      });
    }

    this.validateCommandBody(body.type, body.payload);

    if (body.type === 'UPGRADE_APP' && body.payload?.['apkUrl']) {
      await assertApkUrlReachable(String(body.payload['apkUrl']));
    }

    const commandId = randomUUID();
    const issuedAt = new Date();
    const ttlMs = this.resolveTtlMs(body.type, body.payload);
    const expiresAt = new Date(issuedAt.getTime() + ttlMs);

    const storedPayload = await this.buildStoredPayload(
      deviceId,
      commandId,
      body.type,
      issuedAt,
      body.payload
    );

    await this.commands.create({
      commandId,
      deviceId,
      type: body.type,
      payload: storedPayload,
      status: 'Pending',
      issuedAt,
      expiresAt,
      acknowledgedAt: null,
      deviceResponse: null,
      issuedByUserId,
      dispatchedAt: null,
      deliveredAt: null,
    });

    await this.redis.xadd(
      COMMAND_STREAM,
      '*',
      'commandId',
      commandId,
      'deviceId',
      deviceId
    );

    await this.dispatchQueue.add(
      COMMAND_DISPATCH_JOB,
      { commandId },
      { removeOnComplete: true }
    );

    this.logger.info(
      {
        commandId,
        deviceId,
        type: body.type,
        event: 'command.queued',
        operatorUserId: issuedByUserId,
      },
      'remote command queued'
    );

    return {
      commandId,
      status: 'Pending',
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listForDevice(deviceId: string): Promise<RemoteCommandListResponse> {
    const rows = await this.commands.findByDeviceId(deviceId);
    const data = await Promise.all(
      rows.map(async (r) => {
        let screenshotUrl: string | null = null;
        if (r.type === 'GET_SCREENSHOT' && r.screenshotStorageUrl) {
          try {
            screenshotUrl = await this.storage.getPresignedGetUrl(
              r.screenshotStorageUrl,
              3600
            );
          } catch {
            screenshotUrl = null;
          }
        }
        return {
          commandId: r.commandId,
          deviceId: r.deviceId,
          type: r.type,
          status: r.status,
          issuedAt: r.issuedAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          acknowledgedAt: r.acknowledgedAt
            ? r.acknowledgedAt.toISOString()
            : null,
          deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
          screenshotUrl,
        };
      })
    );
    return { data };
  }
}
