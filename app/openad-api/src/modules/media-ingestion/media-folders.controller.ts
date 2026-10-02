import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FolderService } from './folder.service';
import { MediaIngestionService } from './media-ingestion.service';
import { MediaListQueryDto } from './dto/media-list-query.dto';
import { MediaVfsSearchQueryDto } from './dto/media-vfs-search-query.dto';

type AuthedRequest = Request & { user?: { userId?: string } };

@ApiTags('media-vfs')
@ApiBearerAuth()
@Controller('media/vfs/folders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MediaFoldersController {
  constructor(
    private readonly folders: FolderService,
    private readonly media: MediaIngestionService
  ) {}

  @Get('tree')
  @Roles('fleet_admin', 'super_admin', 'campaign_manager', 'fleet_operator')
  @ApiOperation({ summary: 'List all logical folders (materialized paths)' })
  async tree() {
    const data = await this.folders.listTree();
    return { success: true, data };
  }

  @Get('search')
  @Roles('fleet_admin', 'super_admin', 'campaign_manager', 'fleet_operator')
  @ApiOperation({
    summary: 'Search folder names and file names under a scope folder (recursive)',
  })
  async vfsSearch(@Query() query: MediaVfsSearchQueryDto) {
    const data = await this.media.vfsSearch(query.scopeFolderId, query.q);
    return { success: true, data };
  }

  @Get(':folderId/children')
  @Roles('fleet_admin', 'super_admin', 'campaign_manager', 'fleet_operator')
  @ApiOperation({ summary: 'List direct children of a folder' })
  async children(
    @Param('folderId') folderId: string,
    @Query('q') q?: string
  ) {
    const data = await this.folders.listChildren(folderId, q);
    return { success: true, data };
  }

  @Get(':folderId/assets')
  @Roles('fleet_admin', 'super_admin', 'campaign_manager', 'fleet_operator')
  @ApiOperation({ summary: 'List catalog assets placed in a folder' })
  async assets(
    @Param('folderId') folderId: string,
    @Query() query: MediaListQueryDto
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const data = await this.media.listFolderAssets({
      folderId,
      q: query.q,
      page,
      limit,
    });
    return { success: true, data };
  }

  @Post()
  @HttpCode(201)
  @Roles('fleet_admin', 'super_admin', 'campaign_manager')
  @ApiOperation({ summary: 'Create a folder under /Root' })
  async create(@Body() body: unknown, @Req() req: AuthedRequest) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('JWT user missing');
    }
    const data = await this.folders.createFolder(body, userId);
    return { success: true, data };
  }

  @Delete(':folderId')
  @HttpCode(200)
  @Roles('fleet_admin', 'super_admin', 'campaign_manager')
  @ApiOperation({
    summary: 'Delete an empty folder (no children, no file placements)',
  })
  async remove(@Param('folderId') folderId: string) {
    await this.media.deleteVfsFolder(folderId);
    return { success: true };
  }

  @Patch(':folderId')
  @Roles('fleet_admin', 'super_admin', 'campaign_manager')
  @ApiOperation({ summary: 'Rename or move a non-system folder' })
  async patch(
    @Param('folderId') folderId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest
  ) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new Error('JWT user missing');
    }
    const data = await this.folders.patchFolder(folderId, body, userId);
    return { success: true, data };
  }
}
