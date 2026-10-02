import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { RetiredDeviceRegistryRepository } from './retired-device-registry.repository';

@Injectable()
export class RetiredDeviceGuard implements CanActivate {
  constructor(
    private readonly retiredRegistry: RetiredDeviceRegistryRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const deviceId =
      (req.params?.deviceId as string | undefined) ??
      (req.body as { deviceId?: string } | undefined)?.deviceId;
    if (!deviceId) {
      return true;
    }
    if (await this.retiredRegistry.exists(deviceId)) {
      throw new ForbiddenException('Device is retired and blacklisted');
    }
    return true;
  }
}
