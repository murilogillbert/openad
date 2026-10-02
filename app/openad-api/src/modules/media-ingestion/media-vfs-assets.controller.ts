import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MediaIngestionService } from './media-ingestion.service';

@ApiTags('media-vfs')
@ApiBearerAuth()
@Controller('media/vfs/assets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MediaVfsAssetsController {
  constructor(private readonly mediaIngestion: MediaIngestionService) {}

  @Get(':mediaId')
  @Roles('fleet_admin', 'super_admin', 'campaign_manager', 'fleet_operator')
  @ApiOperation({
    summary:
      'Get catalog asset by mediaId with referenceCount (VFS; same rows as GET /media/:mediaId)',
  })
  async getOne(@Param('mediaId') mediaId: string) {
    const data = await this.mediaIngestion.getAssetDetail(mediaId);
    return { success: true, data };
  }

  @Post(':mediaId/clone')
  @HttpCode(201)
  @Roles('fleet_admin', 'super_admin', 'campaign_manager')
  @ApiOperation({ summary: 'Soft-copy clone — same storage key / hash, new placement row' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['targetFolderId'],
      properties: {
        targetFolderId: { type: 'string' },
        filename: { type: 'string' },
      },
    },
  })
  async clone(
    @Param('mediaId') mediaId: string,
    @Body() body: unknown
  ) {
    const data = await this.mediaIngestion.cloneVfsAsset(mediaId, body);
    return { success: true, data };
  }

  @Patch(':mediaId')
  @Roles('fleet_admin', 'super_admin', 'campaign_manager')
  @ApiOperation({ summary: 'Rename and/or move asset to another folder' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        folderId: { type: 'string' },
      },
    },
  })
  async patch(@Param('mediaId') mediaId: string, @Body() body: unknown) {
    const data = await this.mediaIngestion.patchVfsAsset(mediaId, body);
    return { success: true, data };
  }

  @Delete(':mediaId')
  @HttpCode(200)
  @Roles('fleet_admin', 'super_admin', 'campaign_manager')
  @ApiOperation({
    summary:
      'Soft-delete placement; removes S3 object when last active reference to the key',
  })
  async remove(@Param('mediaId') mediaId: string) {
    await this.mediaIngestion.deleteVfsAsset(mediaId);
    return { success: true };
  }
}
