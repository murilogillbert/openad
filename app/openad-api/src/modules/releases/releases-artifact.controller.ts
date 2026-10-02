import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Readable } from 'stream';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';
import { ReleasesService } from './services/releases.service';

@ApiTags('releases')
@Controller('releases/artifacts')
export class ReleasesArtifactController {
  constructor(
    private readonly releases: ReleasesService,
    private readonly assets: AssetStorageService
  ) {}

  @Get(':token/app.apk')
  @Throttle({
    manifestDevice: {
      limit: 120,
      ttl: 60_000,
      getTracker: (req: Request) =>
        `apk:${(req.params as { token?: string }).token ?? req.ip ?? 'unknown'}`,
    },
  })
  @ApiOperation({ summary: 'Download APK by opaque access token' })
  async download(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const rel = await this.releases.findByAccessToken(token);
    if (!rel || rel.status === 'revoked') {
      throw new NotFoundException();
    }
    const stream = await this.assets.openReadStream(rel.storageRef);
    res.setHeader(
      'Content-Type',
      'application/vnd.android.package-archive'
    );
    res.setHeader('Content-Length', String(rel.sizeBytes));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(rel.originalFilename)}"`
    );
    return new StreamableFile(stream as Readable);
  }
}
