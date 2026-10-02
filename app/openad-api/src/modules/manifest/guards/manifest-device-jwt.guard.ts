import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DevicesRepository } from '../../devices/devices.repository';

/** Validates device JWT `sub` matches `body.deviceId` (POST /manifest, /manifest/sync-status). */
@Injectable()
export class ManifestDeviceJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly devices: DevicesRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Device token required');
    }
    const body = req.body as { deviceId?: string };
    const deviceId = body?.deviceId;
    if (!deviceId) {
      throw new UnauthorizedException('deviceId required in body');
    }
    const token = auth.slice(7);
    let payload: { sub: string; typ?: string; fp?: string };
    try {
      payload = this.jwt.verify<{ sub: string; typ?: string; fp?: string }>(
        token
      );
    } catch {
      throw new UnauthorizedException('Invalid device token');
    }
    if (payload.typ !== 'device' || payload.sub !== deviceId) {
      throw new UnauthorizedException('Invalid device token');
    }

    const device = await this.devices.findByDeviceId(deviceId);
    const stored = device?.hardwareFingerprintHash ?? null;
    if (stored) {
      if (!payload.fp || payload.fp !== stored) {
        throw new UnauthorizedException('Invalid device token');
      }
      const headerFp = req.headers['x-device-fingerprint-hash'];
      if (typeof headerFp !== 'string' || headerFp !== payload.fp) {
        throw new ForbiddenException({
          error: {
            code: 'HARDWARE_MISMATCH',
            message: 'Hardware fingerprint header must match bound device',
          },
        });
      }
    }

    return true;
  }
}
