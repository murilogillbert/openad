import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { DeviceJwtAuthGuard } from '../devices/device-jwt-auth.guard';
import { PlaybackBatchIngestService } from './services/playback-batch-ingest.service';

@ApiTags('analytics')
@Controller('devices/:deviceId/analytics')
export class PlaybackBatchController {
  constructor(private readonly ingest: PlaybackBatchIngestService) {}

  @Post('play-batches')
  @HttpCode(202)
  @SkipThrottle()
  @UseGuards(DeviceJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ingest gzipped or JSON play batch (device JWT)' })
  @ApiResponse({
    status: 202,
    description:
      'Batch accepted (full or partial); per-record rejections in `rejected` when present',
  })
  @ApiResponse({ status: 400, description: 'Invalid batch, gzip, or device mismatch' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async postPlayBatches(
    @Param('deviceId') deviceId: string,
    @Req() req: Request
  ) {
    return this.ingest.ingestFromDeviceRequest(deviceId, req);
  }
}
