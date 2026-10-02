import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UploadSessionService } from './upload-session.service';
import { MediaIngestionService } from './media-ingestion.service';

type AuthedRequest = Request & { user?: { userId?: string } };

@ApiTags('media-vfs')
@ApiBearerAuth()
@Controller('media/vfs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MediaVfsUploadController {
  constructor(
    private readonly uploadSessions: UploadSessionService,
    private readonly mediaIngestion: MediaIngestionService
  ) {}

  @Post('uploads')
  @HttpCode(201)
  @Throttle({ mediaUpload: { limit: 100, ttl: 60_000 } })
  @Roles('fleet_admin', 'super_admin', 'campaign_manager')
  @ApiOperation({
    summary:
      'Start media VFS upload session (bytes must be sent to …/uploads/:sessionId/proxy)',
  })
  async initUpload(@Body() body: unknown, @Req() req: AuthedRequest) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('JWT user missing');
    }
    const data = await this.uploadSessions.createSession(body, userId);
    return { success: true, data };
  }

  @Post('uploads/:sessionId/proxy')
  @HttpCode(204)
  @Throttle({ mediaUpload: { limit: 100, ttl: 60_000 } })
  @Roles('fleet_admin', 'super_admin', 'campaign_manager')
  @ApiOperation({
    summary: 'Upload file bytes through the API (multipart field name: file).',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 524_288_000 },
    })
  )
  async proxyUpload(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthedRequest
  ): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('JWT user missing');
    }
    if (!file?.buffer) {
      throw new BadRequestException({
        error: { code: 'FILE_REQUIRED', message: 'Missing multipart file field "file"' },
      });
    }
    await this.uploadSessions.receiveProxiedUpload(sessionId, userId, file);
  }

  @Post('uploads/:sessionId/complete')
  @HttpCode(200)
  @Throttle({ mediaUpload: { limit: 100, ttl: 60_000 } })
  @Roles('fleet_admin', 'super_admin', 'campaign_manager')
  @ApiOperation({
    summary:
      'Verify uploaded object, register catalog row (probe + DOOH ruleset tag), close session',
  })
  async completeUpload(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() _body: { etag?: string },
    @Req() req: AuthedRequest
  ) {
    void _body;
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('JWT user missing');
    }
    const data = await this.mediaIngestion.completeVfsUpload(sessionId, userId);
    return { success: true, data };
  }
}
