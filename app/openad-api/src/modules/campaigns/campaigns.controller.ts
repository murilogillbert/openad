import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import * as path from 'path';
import { memoryStorage } from 'multer';
import { extractFleetAuditFromRequest } from '../../infrastructure/logging/fleet-audit.context';
import { Throttle } from '@nestjs/throttler';
import { ownerFilterFor } from '../auth/access-scope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AssetUploadService } from './asset-upload.service';
import { AssetDownloadGuard } from './guards/asset-download.guard';
import { CampaignLifecycleService } from './campaign-lifecycle.service';
import { CreativeAssetsRepository } from './creative-assets.repository';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { CreateScheduleRuleBodyDto } from './dto/create-schedule-rule-body.dto';
import { PatchCampaignStatusDto } from './dto/patch-campaign-status.dto';
import { ScheduleRuleService } from '../schedule-rules/schedule-rule.service';
import { CampaignListQueryDto } from './dto/campaign-list-query.dto';
import { AssetStorageService } from '../../infrastructure/storage/asset-storage.service';

type JwtUser = { userId: string; email: string; role: string };

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly lifecycle: CampaignLifecycleService,
    private readonly uploads: AssetUploadService,
    private readonly rules: ScheduleRuleService,
    private readonly assets: CreativeAssetsRepository,
    private readonly assetStorage: AssetStorageService
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'super_admin')
  list(@Query() q: CampaignListQueryDto, @Req() req: Request) {
    const u = req.user as JwtUser | undefined;
    return this.lifecycle.list(
      q.page ?? 1,
      q.limit ?? 50,
      extractFleetAuditFromRequest(req),
      ownerFilterFor({ userId: u?.userId, role: u?.role })
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'super_admin')
  create(@Body() dto: CreateCampaignDto, @Req() req: Request) {
    const u = req.user as JwtUser | undefined;
    return this.lifecycle.create(dto, extractFleetAuditFromRequest(req), u?.userId ?? null);
  }

  @Post(':campaignId/assets')
  @Throttle({ upload: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'super_admin')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 80 * 1024 * 1024 },
    })
  )
  uploadAsset(
    @Param('campaignId') campaignId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('file is required');
    }
    const u = req.user as JwtUser | undefined;
    const mimeType =
      (req.body as { mimeType?: string }).mimeType ?? file.mimetype;
    return this.uploads.saveUploadedFile({
      campaignId,
      originalName: file.originalname,
      buffer: file.buffer,
      mimeType,
      audit: extractFleetAuditFromRequest(req),
      uploadedBy: u?.userId ?? null,
    });
  }

  @Get(':campaignId/assets/:assetId/file')
  @UseGuards(AssetDownloadGuard)
  async downloadAsset(
    @Param('campaignId') campaignId: string,
    @Param('assetId') assetId: string,
    @Res({ passthrough: false }) res: Response
  ) {
    const asset = await this.assets.findByAssetId(assetId);
    if (!asset || asset.campaignId !== campaignId) {
      res.status(404).send('Not found');
      return;
    }
    const stream = await this.assetStorage.openReadStream(asset.storageUrl);
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${path.basename(asset.filename)}"`
    );
    stream.pipe(res);
  }

  @Post(':campaignId/rules')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'super_admin')
  addRule(
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateScheduleRuleBodyDto,
    @Req() req: Request
  ) {
    return this.rules.create(campaignId, dto, extractFleetAuditFromRequest(req));
  }

  /**
   * `content_moderator` entra aqui porque aprovar e recusar sao transicoes de status, e a
   * decisao de quem pode faze-las fica na politica, nao no guard: o guard libera o papel e
   * `CampaignLifecycleService.patchStatus` barra com 403 quem nao for moderador na
   * transicao `pending_review -> active|rejected`. Sem o papel no guard, o moderador levava
   * 403 de `Insufficient role` antes de a politica ser consultada.
   */
  @Patch(':campaignId/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'super_admin', 'content_moderator')
  patchStatus(
    @Param('campaignId') campaignId: string,
    @Body() dto: PatchCampaignStatusDto,
    @Req() req: Request
  ) {
    const u = req.user as JwtUser | undefined;
    return this.lifecycle.patchStatus(
      campaignId,
      dto,
      extractFleetAuditFromRequest(req),
      { userId: u?.userId ?? null, role: u?.role }
    );
  }
}
