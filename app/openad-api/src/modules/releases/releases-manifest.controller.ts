import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { LatestStableManifestResponse } from '@openad/api-contracts';
import { ReleasesService } from './services/releases.service';

@ApiTags('releases')
@Controller('releases/public')
export class ReleasesManifestController {
  private readonly logger = new Logger(ReleasesManifestController.name);

  constructor(private readonly releases: ReleasesService) {}

  @Get('stable-manifest')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    manifestDevice: {
      limit: 60,
      ttl: 60_000,
      getTracker: (req: Request) =>
        `release-manifest:${req.ip ?? 'unknown'}`,
    },
  })
  @ApiOperation({ summary: 'Latest approved stable release manifest (QR / install)' })
  async stableManifest(): Promise<LatestStableManifestResponse | { message: string }> {
    const m = await this.releases.getLatestStableManifest();
    if (!m) {
      this.logger.warn('stable manifest requested but no publication exists');
      return { message: 'No stable release published' };
    }
    return m;
  }
}
