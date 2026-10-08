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

  /**
   * Arquivo do criativo. Responde **302** para o storage, em vez de servir os bytes.
   *
   * ============================================================================
   * Por que redirecionar, e não implementar `Range` aqui
   * ============================================================================
   *
   * A versão anterior fazia `stream.pipe(res)` sem `Range`, `206`, `Accept-Ranges`,
   * `Content-Length` nem `ETag`. Quem baixasse por aqui não tinha como retomar: o downloader do
   * tablete pede `Range: bytes=<offset>-`, e esta rota devolvia `200` com o arquivo inteiro
   * toda vez.
   *
   * Reimplementar `Range` em Node seria reescrever o que o MinIO já faz certo — e foi medido
   * (2026-10-09): o storage responde `206` com `content-range`, expõe `Content-Range`,
   * `Accept-Ranges`, `Content-Length` e `ETag` no CORS, e o preflight aceita `range`. O
   * redirecionamento entrega tudo isso de graça e tira os bytes do caminho da API.
   *
   * ============================================================================
   * O que isto muda para quem já consome
   * ============================================================================
   *
   * Hoje as únicas URLs desta rota saem no push de agenda por MQTT
   * (`schedule-push.service.ts`) e no mapa da frota (`fleet-map.service.ts`), e nenhum leitor
   * dela foi encontrado no código do tablete. `fetch` e `<video src>` seguem `302`
   * automaticamente, então o redirecionamento é transparente para os dois.
   *
   * A autorização continua aqui: o `AssetDownloadGuard` roda antes, e só depois de passar é que
   * a URL assinada é gerada. Ela vale 1 h — tempo suficiente para o download e curto o bastante
   * para não virar um link público permanente.
   */
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
    const url = await this.assetStorage.getPresignedGetUrl(asset.storageUrl, 3600);
    /**
     * `302` e não `301`: a URL de destino é assinada e expira, então ela **não** pode ser
     * memorizada pelo cliente. Um `301` autorizaria o navegador a reusar o destino para sempre,
     * e depois de uma hora a reutilização daria `403` sem passar por aqui de novo.
     */
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, url);
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
