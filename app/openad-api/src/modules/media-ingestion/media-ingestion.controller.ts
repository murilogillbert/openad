import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MediaIngestionService } from './media-ingestion.service';
import { UploadMediaDto } from './dto/upload-media.dto';
import { MediaListQueryDto } from './dto/media-list-query.dto';

const uploadDir = path.join(os.tmpdir(), 'openad-media-upload');

@ApiTags('media-ingestion')
@ApiBearerAuth()
@Controller('media')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MediaIngestionController {
  constructor(private readonly mediaIngestion: MediaIngestionService) {}

  @Post('upload')
  @HttpCode(201)
  @Throttle({ mediaUpload: { limit: 100, ttl: 60_000 } })
  @Roles('fleet_admin', 'super_admin')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload and ingest a video advertisement' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: async (_req, _file, cb) => {
          await fs.mkdir(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}-${file.originalname.replace(/[^\w.-]/g, '_')}`);
        },
      }),
      limits: { fileSize: 524_288_000 },
    })
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMediaDto,
    @Req() req: Request & { user?: { userId?: string } }
  ) {
    const tempPath = file.path;
    try {
      const doc = await this.mediaIngestion.ingestUploadedFile({
        tempPath,
        originalFilename: file.originalname,
        byteLength: file.size,
        dto,
        uploadedBy: req.user?.userId,
      });
      return { success: true, data: doc };
    } catch (e) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw e;
    }
  }

  @Get()
  @Roles('fleet_admin', 'super_admin', 'campaign_manager', 'fleet_operator')
  @ApiOperation({ summary: 'List active media catalog entries' })
  async list(@Query() query: MediaListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.mediaIngestion.listCatalog({ page, limit });
  }

  @Get(':mediaId')
  @Roles('fleet_admin', 'super_admin', 'campaign_manager', 'fleet_operator')
  @ApiOperation({ summary: 'Get media asset details' })
  async getOne(@Param('mediaId') mediaId: string) {
    const data = await this.mediaIngestion.getById(mediaId);
    return { success: true, data };
  }

  @Delete(':mediaId')
  @Roles('fleet_admin', 'super_admin')
  @ApiOperation({ summary: 'Soft-delete a media asset' })
  async remove(@Param('mediaId') mediaId: string) {
    await this.mediaIngestion.softDelete(mediaId);
    return { success: true };
  }
}
