import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DevicesRepository } from './devices.repository';

/** Bearer JWT with `{ sub: deviceId, typ: 'device', fp?: string }`. If device has `hardwareFingerprintHash`, require matching `fp` and `X-Device-Fingerprint-Hash` header. */
@Injectable()
export class DeviceJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly devices: DevicesRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const deviceId = req.params['deviceId'] as string | undefined;
    const auth = req.headers.authorization;
    if (!deviceId || !auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Device token required');
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
