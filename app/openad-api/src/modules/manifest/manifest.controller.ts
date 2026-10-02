import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ManifestRequestDto } from './dto/manifest-request.dto';
import { SyncStatusDto } from './dto/sync-status.dto';
import { ManifestDeviceJwtGuard } from './guards/manifest-device-jwt.guard';
import { ManifestService } from './manifest.service';

function manifestThrottleTracker(req: Request): string {
  const id = (req.body as { deviceId?: string })?.deviceId;
  return `manifest:${id ?? req.ip ?? 'unknown'}`;
}

@ApiTags('manifest')
@ApiBearerAuth()
@Controller('manifest')
@UseGuards(ManifestDeviceJwtGuard)
export class ManifestController {
  constructor(private readonly manifest: ManifestService) {}

  @Post()
  @HttpCode(200)
  @Throttle({
    manifestDevice: {
      limit: 10,
      ttl: 60_000,
      getTracker: manifestThrottleTracker,
    },
  })
  @ApiOperation({ summary: 'Fetch full or delta manifest for device' })
  async fetchManifest(@Body() dto: ManifestRequestDto) {
    return this.manifest.getManifest(dto);
  }

  @Post('sync-status')
  @HttpCode(200)
  @Throttle({
    manifestDevice: {
      limit: 10,
      ttl: 60_000,
      getTracker: manifestThrottleTracker,
    },
  })
  @ApiOperation({ summary: 'Report successful manifest sync' })
  async syncStatus(@Body() dto: SyncStatusDto) {
    await this.manifest.recordSyncStatus(dto);
    return { success: true, message: 'Sync status updated' };
  }
}
