import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { DeviceUpdateManifestResponse } from '@openad/api-contracts';
import { DeviceJwtAuthGuard } from '../devices/device-jwt-auth.guard';
import { DevicesRepository } from '../devices/devices.repository';
import { ReportReleaseStateDto } from './dto/report-release-state.dto';
import { ReleasesService } from './services/releases.service';

@ApiTags('releases')
@ApiBearerAuth()
@Controller('releases/devices')
export class ReleasesDeviceController {
  constructor(
    private readonly releases: ReleasesService,
    private readonly devices: DevicesRepository
  ) {}

  @Get(':deviceId/update-manifest')
  @HttpCode(200)
  @UseGuards(DeviceJwtAuthGuard)
  @Throttle({
    manifestDevice: {
      limit: 20,
      ttl: 60_000,
      getTracker: (req: Request) =>
        `rel-dev:${(req.params as { deviceId?: string }).deviceId ?? 'unknown'}`,
    },
  })
  @ApiOperation({ summary: 'Per-device update manifest (staged rollout)' })
  async updateManifest(
    @Param('deviceId') deviceId: string,
    @Query('currentVersion') currentVersion: string
  ): Promise<DeviceUpdateManifestResponse> {
    const cv = currentVersion?.trim() || '0.0.0';
    return this.releases.getDeviceUpdateManifest({
      deviceId,
      currentVersionIdentifier: cv,
    });
  }

  @Put(':deviceId/report')
  @HttpCode(204)
  @UseGuards(DeviceJwtAuthGuard)
  @ApiOperation({ summary: 'Report installed version and last update check' })
  async report(
    @Param('deviceId') deviceId: string,
    @Body() dto: ReportReleaseStateDto
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (dto.versionIdentifier) {
      patch.currentRelease = {
        versionIdentifier: dto.versionIdentifier,
        installedAt: new Date(),
      };
    }
    if (dto.lastCheckResult || dto.lastError !== undefined) {
      patch.updateState = {
        lastCheckAt: new Date(),
        lastCheckResult: dto.lastCheckResult ?? 'unknown',
        lastError: dto.lastError ?? null,
      };
    }
    if (Object.keys(patch).length === 0) {
      return;
    }
    await this.devices.updateOne(
      { deviceId },
      { $set: patch }
    );
  }
}
